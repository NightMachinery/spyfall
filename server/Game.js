const Player = require("./Player");
const Wordpacks = require("./Wordpacks");

const DISCONNECTED_PLAYER_TTL_MS = 2 * 60 * 1000;
const MAX_CUSTOM_WORDS_TEXT_LENGTH = 20000;
const MAX_QUESTION_LENGTH = 160;
const MAX_GUESS_LENGTH = 120;
const ALL_SPY_CHANCE = 0.02;
const MIN_QUESTION_RESPONSE_SECONDS = 15;
const ZERO_SPY_DELAY_MIN_SECONDS = 5;
const ZERO_SPY_DELAY_MAX_SECONDS = 25;

class Game {
	constructor(code, onEmpty, getMinutesUntilRestart) {
		this.code = code;
		this.onEmpty = onEmpty;

		this.locked = false;
		this.getMinutesUntilRestart = getMinutesUntilRestart;

		this.players = [];
		this.creatorAuthToken = null;
		this.tempAdminAuthTokens = new Set();
		this.status = "lobby-waiting";
		this.roundPhase = "idle";
		this.roundMode = "wordpack";
		this.word = null;
		this.wordList = [];
		this.timeLeft = null;
		this.timePaused = false;
		this.currentRoundNum = 0;
		this.currentRoundSpyCount = 0;
		this.questionHistory = [];
		this.accusationLog = [];
		this.activeQuestion = null;
		this.questionTurn = {
			suggestedAskerAuthToken: null,
			suggestedTargetAuthToken: null,
		};
		this.accusationPhase = null;
		this.activeAccusationVote = null;
		this.pendingRoundOutcome = null;
		this.timer = null;
		this.questionTimeout = null;
		this.preRoundDelayTimeout = null;
		this.settings = {
			wordpack: "Spyfall1",
			timeLimit: 8,
			includeAllSpy: false,
			allowSpyRefusal: true,
			spyCountMin: 0,
			spyCountMax: 1,
			spyCountDistribution: "uniform",
			customWordsEnabled: false,
			customWordsText: "",
			customSubsetSize: 12,
			autoEndWhenAllSpiesRevealed: true,
			answerFlipChancePercent: 10,
			spyGuessLimit: 2,
			accusationsPerPlayer: 1,
			questionResponseSeconds: 0,
		};
		this.spyOfferState = null;

		setTimeout(() => this.deleteGameIfEmpty(), 60 * 1000);
	}

	resolveAuthToken = (socket, authToken) => {
		if (typeof authToken === "string" && authToken.trim()) {
			return authToken.trim();
		}
		return `anon:${socket.id}`;
	};

	sendNewStateToAllPlayers = () => {
		for (const player of this.players) {
			if (!player.socket || !player.connected) continue;
			player.socket.emit("gameChange", this.getStateForPlayer(player));
		}
	};

	appendAccusationLog = (message) => {
		if (!message) return;
		this.accusationLog.push({
			id: `acc-${Date.now()}-${Math.random().toString(16).slice(2)}`,
			message,
		});
		if (this.accusationLog.length > 80) {
			this.accusationLog = this.accusationLog.slice(-80);
		}
	};

	emitRoundOutcome = (payload) => {
		for (const player of this.players) {
			if (!player.socket || !player.connected) continue;
			player.socket.emit("roundOutcome", this.withReveal(payload, player));
		}
	};

	getRevealKind = () => "word";

	getLocalizedWordForPlayer = (player, word = this.word) => {
		if (!word) return null;
		if (this.roundMode === "custom") {
			return normalizeWordEntry(word);
		}
		return Wordpacks.localizeWord(this.settings.wordpack, word, player?.locale);
	};

	getLocalizedWordListForPlayer = (player, wordList = this.wordList) => {
		if (this.roundMode === "custom") {
			return (wordList || []).map((word) => normalizeWordEntry(word));
		}
		return Wordpacks.localizeWordList(
			this.settings.wordpack,
			wordList,
			player?.locale,
		);
	};

	getRevealLabel = (player) =>
		this.getLocalizedWordForPlayer(player, this.word)?.label || null;

	withReveal = (payload = {}, player) => {
		const revealedLabel = this.getRevealLabel(player);
		const revealKind = this.getRevealKind();
		const revealText = revealedLabel
			? ` Revealed ${revealKind}: ${revealedLabel}.`
			: "";
		return {
			...payload,
			revealKind,
			revealedWordLabel: revealedLabel,
			text: `${payload?.text || ""}${revealText}`.trim(),
		};
	};

	initPlayer(socket, authToken, locale) {
		const player = this.addPlayer(socket, authToken, locale);
		this.attachListenersToPlayer(player);

		this.refreshAdminState();
		this.normalizeSettings();
		if (this.roundPhase === "offering-spies") {
			this.advanceSpyOfferFlow();
		} else {
			this.checkIfReady();
			this.refreshSuggestedQuestionTurn();
		}
		this.sendNewStateToAllPlayers();
	}

	addPlayer(socket, authToken, locale) {
		const resolvedAuthToken = this.resolveAuthToken(socket, authToken);
		const playerToReplace = this.findPlayerByAuthToken(resolvedAuthToken);

		if (playerToReplace) {
			return Game.replacePlayer(playerToReplace, socket, locale);
		}

		return this.createPlayer(socket, resolvedAuthToken, locale);
	}

	createPlayer(socket, authToken, locale) {
		const newPlayer = new Player(socket, authToken, locale);
		if (!this.creatorAuthToken) {
			this.creatorAuthToken = authToken;
		}

		this.players.push(newPlayer);

		if (this.status === "ingame") {
			this.createPlayerWhileInGame(newPlayer);
		}

		return newPlayer;
	}

	static replacePlayer(player, socket, locale) {
		if (player.socket && player.socket !== socket) {
			player.socket.removeAllListeners();
			try {
				player.socket.disconnect(true);
			} catch (_error) {
				// no-op
			}
		}

		player.clearDisconnectTimeout();
		player.socket = socket;
		player.connected = true;
		player.setLocale(locale);
		return player;
	}

	createPlayerWhileInGame(player) {
		player.observer = true;
		player.observerReason = "late-join";
		player.role = null;
		player.guessesRemaining = 0;
		player.accusationsRemaining = 0;
	}

	findPlayerByAuthToken = (authToken) =>
		this.players.find((player) => player.authToken === authToken);

	getConnectedPlayers = () => this.players.filter((player) => player.connected);

	creatorPlayerConnected = () =>
		this.players.some((player) => this.isCreator(player) && player.connected);

	pickFallbackAdmin = () => {
		const connectedPlayers = this.getConnectedPlayers().filter(
			(player) => !this.isCreator(player),
		);
		if (connectedPlayers.length === 0) return null;

		const namedPlayers = connectedPlayers.filter((player) => player.name);
		const adminPool = namedPlayers.length > 0 ? namedPlayers : connectedPlayers;
		return adminPool[Math.floor(Math.random() * adminPool.length)];
	};

	refreshAdminState = () => {
		if (this.creatorPlayerConnected()) {
			this.tempAdminAuthTokens = new Set();
			return;
		}

		const connectedTempAdmin = this.players.find(
			(player) =>
				player.connected &&
				player.authToken &&
				this.tempAdminAuthTokens.has(player.authToken),
		);
		if (connectedTempAdmin) {
			this.tempAdminAuthTokens = new Set([connectedTempAdmin.authToken]);
			return;
		}

		const fallbackAdmin = this.pickFallbackAdmin();
		this.tempAdminAuthTokens = fallbackAdmin?.authToken
			? new Set([fallbackAdmin.authToken])
			: new Set();
	};

	removePlayerByName = (actor, theName) => {
		if (!this.isAdmin(actor)) {
			this.emitUnauthorized(actor.socket);
			return;
		}

		const player = this.findPlayerByName(theName);
		if (!player || player === actor) return;

		this.forceRemovePlayer(player);
		this.normalizeSettings();
		this.checkIfReady();
		this.sendNewStateToAllPlayers();
	};

	findPlayerByName = (theName) =>
		this.players.find(({ name }) => name === theName);

	handleDisconnect = (player) => () => {
		player.connected = false;

		if (!player.name) {
			this.deletePlayer(player);
		} else {
			this.scheduleDisconnectedPlayerCleanup(player);
		}

		this.cleanupInteractiveStateForPlayer(player);
		this.refreshAdminState();
		if (this.roundPhase === "offering-spies") {
			this.advanceSpyOfferFlow();
		} else if (this.status !== "ingame") {
			this.normalizeSettings();
			this.checkIfReady();
		} else if (this.isSpyGuessPhase()) {
			this.maybeFinalizeGuessPhase();
		} else if (this.accusationPhase || this.activeAccusationVote) {
			this.reconcileAccusationState();
		}
		this.refreshSuggestedQuestionTurn();

		this.sendNewStateToAllPlayers();
		this.deleteGameIfEmpty();
	};

	scheduleDisconnectedPlayerCleanup = (player) => {
		player.clearDisconnectTimeout();
		player.disconnectTimeout = setTimeout(() => {
			if (player.connected) return;

			this.deletePlayer(player);
			this.cleanupInteractiveStateForPlayer(player);
			this.refreshAdminState();
			if (this.roundPhase === "offering-spies") {
				this.advanceSpyOfferFlow();
			} else {
				this.normalizeSettings();
				this.checkIfReady();
				this.maybeFinalizeGuessPhase();
				this.reconcileAccusationState();
			}
			this.refreshSuggestedQuestionTurn();
			this.sendNewStateToAllPlayers();
			this.deleteGameIfEmpty();
		}, DISCONNECTED_PLAYER_TTL_MS);
	};

	deleteGameIfEmpty = () => {
		if (this.noPlayersLeft() && this.code !== "ffff") {
			this.clearTimer();
			this.clearQuestionTimeout();
			this.clearPreRoundDelay();
			this.disconnectAllPlayers();
			this.onEmpty();
		}
	};

	deletePlayer = (player) => {
		player.clearDisconnectTimeout();
		const index = this.players.indexOf(player);
		if (index > -1) {
			this.players.splice(index, 1);
		}
		this.refreshAdminState();
	};

	forceRemovePlayer = (player) => {
		player.clearDisconnectTimeout();
		this.cleanupInteractiveStateForPlayer(player);

		if (player.socket) {
			player.socket.removeAllListeners();
			try {
				player.socket.disconnect(true);
			} catch (_error) {
				// no-op
			}
		}

		this.deletePlayer(player);
		if (this.roundPhase === "offering-spies") {
			this.advanceSpyOfferFlow();
		}
		this.deleteGameIfEmpty();
	};

	cleanupInteractiveStateForPlayer = (player) => {
		if (this.activeQuestion) {
			const isQuestionPlayer =
				this.activeQuestion.askerAuthToken === player.authToken ||
				this.activeQuestion.targetAuthToken === player.authToken;
			if (isQuestionPlayer) {
				const lastAskerAuthToken = this.activeQuestion.askerAuthToken;
				this.clearQuestionTimeout();
				this.activeQuestion = null;
				this.refreshSuggestedQuestionTurn(lastAskerAuthToken);
			}
		}

		if (this.activeAccusationVote) {
			const vote = this.activeAccusationVote;
			const wasEligibleVoter = vote.eligibleVoterAuthTokens.includes(
				player.authToken,
			);
			vote.eligibleVoterAuthTokens = vote.eligibleVoterAuthTokens.filter(
				(authToken) => authToken !== player.authToken,
			);
			if (
				vote.targetAuthToken === player.authToken ||
				vote.initiatedByAuthToken === player.authToken
			) {
				this.activeAccusationVote = null;
			}
			if (wasEligibleVoter && this.activeAccusationVote) {
				this.maybeFinalizeAccusationVote();
			}
		}

		if (this.accusationPhase) {
			if (this.accusationPhase.currentTurnAuthToken === player.authToken) {
				this.accusationPhase.currentTurnAuthToken = null;
			}
			this.accusationPhase.queue = this.accusationPhase.queue.filter(
				(entry) => entry.authToken !== player.authToken,
			);
		}
	};

	reconcileAccusationState = () => {
		if (!this.accusationPhase && !this.activeAccusationVote) return;

		if (this.activeAccusationVote) {
			this.activeAccusationVote.eligibleVoterAuthTokens =
				this.activeAccusationVote.eligibleVoterAuthTokens.filter(
					(authToken) => {
						const player = this.findPlayerByAuthToken(authToken);
						return this.canPlayerVote(player);
					},
				);
			if (
				this.activeAccusationVote.targetAuthToken &&
				!this.canBePlayerAccusationTarget(
					this.findPlayerByAuthToken(this.activeAccusationVote.targetAuthToken),
				)
			) {
				this.activeAccusationVote = null;
			}
			if (this.activeAccusationVote) {
				this.maybeFinalizeAccusationVote();
			}
		}

		if (this.accusationPhase && !this.activeAccusationVote) {
			this.advanceAccusationPhase();
		}
	};

	noPlayersLeft = () => this.players.every((player) => !player.name);

	disconnectAllPlayers = () =>
		this.players.forEach(({ socket }) => {
			if (!socket) return;
			socket.removeAllListeners();
			try {
				socket.disconnect(true);
			} catch (_error) {
				// no-op
			}
		});

	removeDisconnectedPlayers = () => {
		for (const player of [...this.players]) {
			if (!player.connected) {
				this.deletePlayer(player);
			}
		}
	};

	attachListenersToPlayer = (player) => {
		const { socket } = player;
		socket.on("name", this.setName(player));
		socket.on("startGame", this.startGame(player));
		socket.on("kickPlayer", (name) => this.kickPlayerByName(player, name));
		socket.on("removePlayer", (name) => this.removePlayerByName(player, name));
		socket.on("promoteObserver", (name) =>
			this.promoteObserverByName(player, name),
		);
		socket.on("togglePlayerObserver", (name) =>
			this.togglePlayerObserverByName(player, name),
		);
		socket.on("disconnect", this.handleDisconnect(player));
		socket.on("togglePause", () => this.togglePauseTimer(player));
		socket.on("endGame", () => this.endGame(player));
		socket.on("acceptSpyOffer", () => this.acceptSpyOffer(player));
		socket.on("refuseSpyOffer", () => this.refuseSpyOffer(player));
		socket.on("updateSettings", (settings) =>
			this.updateSettings(player, settings),
		);
		socket.on("setLocale", (locale) => this.setPlayerLocale(player, locale));
		socket.on("clearName", () => this.clearName(player)());
		socket.on("submitQuestionPrompt", (payload) =>
			this.submitQuestionPrompt(player, payload),
		);
		socket.on("chooseQuestionOption", (questionIndex) =>
			this.chooseQuestionOption(player, questionIndex),
		);
		socket.on("submitSpyGuess", (guess) => this.submitSpyGuess(player, guess));
		socket.on("completeTimeoutGuessing", () =>
			this.completeTimeoutGuessing(player),
		);
		socket.on("endTimeoutGuessPhase", () => this.endTimeoutGuessPhase(player));
		socket.on("startPlayerAccusation", (targetName) =>
			this.startPlayerAccusation(player, targetName),
		);
		socket.on("submitPlayerAccusation", (targetName) =>
			this.submitPlayerAccusation(player, targetName),
		);
		socket.on("passAccusationTurn", () => this.passAccusationTurn(player));
		socket.on("startTerminalAccusation", (targetType) =>
			this.startTerminalAccusation(player, targetType),
		);
		socket.on("voteAccusation", (vote) => this.voteAccusation(player, vote));
	};

	setPlayerLocale = (player, locale) => {
		player.setLocale(locale);
		if (player.socket && player.connected) {
			player.socket.emit("gameChange", this.getStateForPlayer(player));
		}
	};

	setName = (newPlayer) => (name) => {
		const cleanedName = sanitizeName(name);
		const validLength = cleanedName.length > 1 && cleanedName.length <= 24;

		if (!this.isNameTaken(cleanedName, newPlayer) && validLength) {
			newPlayer.name = cleanedName;
		} else {
			newPlayer.name = "";
			newPlayer.socket.emit("badName");
		}

		this.normalizeSettings();
		this.checkIfReady();
		this.sendNewStateToAllPlayers();
	};

	clearName = (player) => () => {
		player.name = "";

		this.normalizeSettings();
		this.checkIfReady();
		this.sendNewStateToAllPlayers();
	};

	isNameTaken = (nameToCheck, ignorePlayer = null) =>
		this.players.reduce((answer, player) => {
			if (player === ignorePlayer) return answer;
			return player.name === nameToCheck || answer;
		}, false);

	checkIfReady = () => {
		if (this.status === "ingame") return false;

		const activePlayers = this.players.filter(
			(player) => !player.manualObserver,
		);
		const everyoneHasName =
			activePlayers.length >= 2 &&
			activePlayers.reduce(
				(answer, player) => Boolean(player.name) && answer,
				true,
			);
		const everyoneConnected = activePlayers.reduce(
			(answer, player) => player.connected && answer,
			true,
		);

		const isReady = everyoneHasName && everyoneConnected;
		this.status = isReady ? "lobby-ready" : "lobby-waiting";
		return isReady;
	};

	startGame = (player) => () => {
		if (!this.isAdmin(player)) {
			this.emitUnauthorized(player.socket);
			return;
		}
		if (this.status !== "lobby-ready") return;
		if (this.locked) {
			player.socket.emit("lockedWarning", this.getMinutesUntilRestart());
			return;
		}

		const roundStarted = this.prepareRound(player);
		if (!roundStarted) return;

		this.status = "ingame";
		this.currentRoundNum++;
		this.sendNewStateToAllPlayers();
	};

	prepareRound = (player) => {
		const roundPlayers = this.getRoundSetupPlayers();
		if (roundPlayers.length < 2) {
			this.emitActionError(
				player.socket,
				"At least 2 connected players are required.",
			);
			return false;
		}

		this.clearTimer();
		this.clearQuestionTimeout();
		this.clearPreRoundDelay();
		this.roundPhase = "idle";
		this.resetSpyOfferState();
		this.resetAccusationState();
		this.timeLeft = null;
		this.timePaused = false;
		this.questionHistory = [];
		this.accusationLog = [];
		this.activeQuestion = null;
		this.questionTurn = {
			suggestedAskerAuthToken: null,
			suggestedTargetAuthToken: null,
		};
		this.currentRoundSpyCount = 0;
		this.pendingRoundOutcome = null;
		this.players.forEach((thePlayer) => {
			const manualObserver = thePlayer.manualObserver;
			thePlayer.resetRoundState();
			thePlayer.manualObserver = manualObserver;
		});

		const wordPicked = this.pickWord(player);
		if (!wordPicked) return false;

		this.pickFirst(roundPlayers);

		const useAllSpyOverride =
			Boolean(this.settings.includeAllSpy) && Math.random() < ALL_SPY_CHANCE;
		if (useAllSpyOverride) {
			this.setAllAsSpy(roundPlayers);
			this.finishRoundAssignment(roundPlayers);
			return true;
		}

		const spyCount = this.pickSpyCount(roundPlayers.length);
		if (this.settings.allowSpyRefusal && spyCount > 0) {
			return this.startSpyOfferFlow(roundPlayers, spyCount);
		}

		this.assignSpies(roundPlayers, spyCount);
		if (spyCount === 0) {
			return this.startZeroSpyDelay(roundPlayers);
		}
		this.finishRoundAssignment(roundPlayers);
		return true;
	};

	startZeroSpyDelay = (roundPlayers) => {
		this.clearPreRoundDelay();
		this.roundPhase = "zero-spy-delay";
		const delayMs =
			randomIntInclusive(
				ZERO_SPY_DELAY_MIN_SECONDS,
				ZERO_SPY_DELAY_MAX_SECONDS,
			) * 1000;
		this.preRoundDelayTimeout = setTimeout(() => {
			this.preRoundDelayTimeout = null;
			if (this.status !== "ingame" || this.roundPhase !== "zero-spy-delay") {
				return;
			}

			const connectedRoundPlayers = this.getRoundSetupPlayers();
			if (connectedRoundPlayers.length < 2) {
				this.abortPendingRound("At least 2 connected players are required.");
				return;
			}

			this.finishRoundAssignment(connectedRoundPlayers);
			this.sendNewStateToAllPlayers();
		}, delayMs);
		return true;
	};

	finishRoundAssignment = (roundPlayers) => {
		this.clearPreRoundDelay();
		this.currentRoundSpyCount = roundPlayers.filter(
			(player) => player.role === "spy",
		).length;
		roundPlayers.forEach((player) => {
			player.guessesRemaining =
				player.role === "spy" ? this.settings.spyGuessLimit : 0;
			player.accusationsRemaining = 1;
		});
		this.roundPhase = "active";
		this.refreshSuggestedQuestionTurn(
			roundPlayers.find((player) => player.isFirst)?.authToken || null,
			{ useExact: true },
		);
		this.startTimer();
	};

	endGame = (player) => {
		if (!this.isAdmin(player)) {
			this.emitUnauthorized(player.socket);
			return;
		}
		this.resetToLobbyState();
	};

	resetToLobbyState = ({ decrementRound = false } = {}) => {
		if (decrementRound && this.currentRoundNum > 0) {
			this.currentRoundNum--;
		}

		this.status = "lobby-waiting";
		this.roundPhase = "idle";
		this.roundMode = "wordpack";
		this.word = null;
		this.wordList = [];
		this.timeLeft = null;
		this.timePaused = false;
		this.questionHistory = [];
		this.accusationLog = [];
		this.activeQuestion = null;
		this.questionTurn = {
			suggestedAskerAuthToken: null,
			suggestedTargetAuthToken: null,
		};
		this.currentRoundSpyCount = 0;
		this.pendingRoundOutcome = null;
		this.resetSpyOfferState();
		this.resetAccusationState();
		this.clearTimer();
		this.clearQuestionTimeout();
		this.clearPreRoundDelay();

		this.removeDisconnectedPlayers();
		this.players.forEach((thePlayer) => {
			const manualObserver = thePlayer.manualObserver;
			thePlayer.resetRoundState();
			thePlayer.manualObserver = manualObserver;
		});

		this.refreshAdminState();
		this.normalizeSettings();
		this.checkIfReady();
		this.sendNewStateToAllPlayers();
		this.deleteGameIfEmpty();
	};

	finishRoundWithOutcome = (payload) => {
		this.pendingRoundOutcome = null;
		this.emitRoundOutcome(payload);
		this.resetToLobbyState();
	};

	pickWord = (player) => {
		if (this.settings.customWordsEnabled) {
			const allWords = this.getParsedCustomWords();
			if (allWords.length < 2) {
				this.emitActionError(
					player.socket,
					"Custom word mode needs at least 2 words.",
				);
				return false;
			}

			const subsetSize = clamp(
				this.settings.customSubsetSize,
				2,
				allWords.length,
			);
			const shuffledWords = shuffleArray(allWords.slice());
			const subset = shuffledWords.slice(0, subsetSize);
			const chosenWord =
				subset[Math.floor(Math.random() * subset.length)] || subset[0];

			this.roundMode = "custom";
			this.word = chosenWord;
			this.wordList = subset;
			return true;
		}

		const { wordpack } = this.settings;
		const nextWord = Wordpacks.getRandomWordFromPack(wordpack);
		if (!nextWord) {
			this.emitActionError(player.socket, "That wordpack is unavailable.");
			return false;
		}

		this.roundMode = "wordpack";
		this.word = nextWord;
		this.wordList = Wordpacks.getWordListFromPack(wordpack);
		return true;
	};

	assignSpies = (players, spyCount) => {
		const shuffledPlayers = shuffleArray(players.slice());
		for (const player of shuffledPlayers.slice(0, spyCount)) {
			player.role = "spy";
		}
	};

	startSpyOfferFlow = (players, spyCount) => {
		this.roundPhase = "offering-spies";
		this.spyOfferState = {
			targetSpyCount: spyCount,
			offerOrderAuthTokens: shuffleArray(
				players.map((player) => player.authToken),
			),
			refusedAuthTokens: new Set(),
			acceptedAuthTokens: new Set(),
			currentOfferAuthToken: null,
		};
		this.syncPendingSpyRoles();
		return this.advanceSpyOfferFlow();
	};

	advanceSpyOfferFlow = () => {
		if (this.roundPhase !== "offering-spies" || !this.spyOfferState)
			return false;

		const roundPlayers = this.getRoundSetupPlayers();
		if (roundPlayers.length < 2) {
			this.abortPendingRound("At least 2 connected players are required.");
			return false;
		}

		const playerMap = new Map(
			roundPlayers.map((player) => [player.authToken, player]),
		);
		const { acceptedAuthTokens, refusedAuthTokens, offerOrderAuthTokens } =
			this.spyOfferState;

		for (const authToken of [...acceptedAuthTokens]) {
			if (!playerMap.has(authToken)) acceptedAuthTokens.delete(authToken);
		}
		for (const authToken of [...refusedAuthTokens]) {
			if (!playerMap.has(authToken)) refusedAuthTokens.delete(authToken);
		}

		const remainingSpySlots =
			this.spyOfferState.targetSpyCount - acceptedAuthTokens.size;
		if (remainingSpySlots <= 0) {
			this.finalizeSpyOfferFlow();
			return true;
		}

		const remainingCandidates = offerOrderAuthTokens.filter(
			(authToken) =>
				playerMap.has(authToken) &&
				!acceptedAuthTokens.has(authToken) &&
				!refusedAuthTokens.has(authToken),
		);

		if (remainingCandidates.length < remainingSpySlots) {
			this.abortPendingRound(
				"Not enough connected players remain to finish assigning spies.",
			);
			return false;
		}

		if (remainingCandidates.length === remainingSpySlots) {
			for (const authToken of remainingCandidates) {
				acceptedAuthTokens.add(authToken);
			}
			this.syncPendingSpyRoles();
			this.finalizeSpyOfferFlow();
			return true;
		}

		const currentOfferAuthToken = this.spyOfferState.currentOfferAuthToken;
		if (!remainingCandidates.includes(currentOfferAuthToken)) {
			this.spyOfferState.currentOfferAuthToken = remainingCandidates[0] || null;
		}

		this.syncPendingSpyRoles();
		return true;
	};

	finalizeSpyOfferFlow = () => {
		if (!this.spyOfferState) return;

		const roundPlayers = this.getRoundSetupPlayers();
		const roundPlayerAuthTokens = new Set(
			roundPlayers.map((player) => player.authToken),
		);
		const acceptedAuthTokens = new Set(
			[...this.spyOfferState.acceptedAuthTokens].filter((authToken) =>
				roundPlayerAuthTokens.has(authToken),
			),
		);

		roundPlayers.forEach((player) => {
			player.role = acceptedAuthTokens.has(player.authToken) ? "spy" : null;
		});

		if (acceptedAuthTokens.size !== this.spyOfferState.targetSpyCount) {
			this.abortPendingRound(
				"Not enough connected players remain to finish assigning spies.",
			);
			return;
		}

		this.resetSpyOfferState();
		this.finishRoundAssignment(roundPlayers);
	};

	resetSpyOfferState = () => {
		this.spyOfferState = null;
	};

	syncPendingSpyRoles = () => {
		const acceptedAuthTokens =
			this.spyOfferState?.acceptedAuthTokens || new Set();
		this.players.forEach((player) => {
			if (player.manualObserver || player.observer) {
				player.role = null;
				return;
			}
			player.role = acceptedAuthTokens.has(player.authToken) ? "spy" : null;
		});
	};

	getSpyOfferForPlayer = (player) => {
		if (this.roundPhase !== "offering-spies" || !this.spyOfferState)
			return null;
		if (player.authToken !== this.spyOfferState.currentOfferAuthToken)
			return null;
		return { canRefuse: true };
	};

	acceptSpyOffer = (player) => {
		if (this.roundPhase !== "offering-spies" || !this.spyOfferState) return;
		if (
			player.manualObserver ||
			player.observer ||
			!player.connected ||
			!player.name
		)
			return;
		if (player.authToken !== this.spyOfferState.currentOfferAuthToken) return;

		this.spyOfferState.acceptedAuthTokens.add(player.authToken);
		this.spyOfferState.currentOfferAuthToken = null;
		this.advanceSpyOfferFlow();
		this.sendNewStateToAllPlayers();
	};

	refuseSpyOffer = (player) => {
		if (this.roundPhase !== "offering-spies" || !this.spyOfferState) return;
		if (
			player.manualObserver ||
			player.observer ||
			!player.connected ||
			!player.name
		)
			return;
		if (player.authToken !== this.spyOfferState.currentOfferAuthToken) return;

		this.spyOfferState.refusedAuthTokens.add(player.authToken);
		this.spyOfferState.currentOfferAuthToken = null;
		player.role = null;
		this.advanceSpyOfferFlow();
		this.sendNewStateToAllPlayers();
	};

	abortPendingRound = (message) => {
		this.resetToLobbyState({ decrementRound: this.status === "ingame" });
		if (message) {
			this.emitActionErrorToAll(message);
		}
	};

	resetAccusationState = () => {
		this.accusationPhase = null;
		this.activeAccusationVote = null;
	};

	setAllAsSpy = (players) =>
		players.forEach((player) => {
			player.role = "spy";
		});

	pickFirst = (players) => {
		players[Math.floor(Math.random() * players.length)].isFirst = true;
	};

	pickSpyCount = (playerCount) => {
		const { min, max } = this.getValidatedSpyRange(playerCount);
		if (min === max) return min;
		if (this.settings.spyCountDistribution !== "geometric") {
			return randomIntInclusive(min, max);
		}

		const values = [];
		for (let value = min; value <= max; value++) {
			values.push(value);
		}
		const weights = values.map((_value, index) => 1 / 2 ** index);
		const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
		let randomWeight = Math.random() * totalWeight;
		for (let i = 0; i < values.length; i++) {
			randomWeight -= weights[i];
			if (randomWeight <= 0) return values[i];
		}
		return values[values.length - 1];
	};

	cancelInteractiveRoundState = () => {
		this.clearQuestionTimeout();
		this.activeQuestion = null;
		this.resetAccusationState();
		this.refreshSuggestedQuestionTurn();
	};

	isSpyGuessPhase = () =>
		this.roundPhase === "timeout-guess" ||
		this.roundPhase === "revealed-spy-guess";

	canPlayerSubmitSpyGuess = (player) =>
		Boolean(
			player &&
				player.connected &&
				player.name &&
				!player.manualObserver &&
				!player.observer &&
				player.role === "spy" &&
				player.guessesRemaining > 0 &&
				this.status === "ingame" &&
				(this.roundPhase === "active" ||
					(this.isSpyGuessPhase() && !player.timeoutGuessDone)),
		);

	canParticipateInGuessPhase = (player) =>
		Boolean(
			this.isSpyGuessPhase() &&
				player &&
				player.connected &&
				player.name &&
				!player.manualObserver &&
				!player.observer &&
				player.role === "spy",
		);

	getPendingGuessers = () =>
		this.players.filter(
			(player) =>
				this.canParticipateInGuessPhase(player) &&
				player.guessesRemaining > 0 &&
				!player.timeoutGuessDone,
		);

	handleRoundTimerExpired = () => {
		if (!this.isRoundActive()) return;
		this.clearTimer();
		this.timeLeft = 0;
		this.timePaused = false;
		this.pendingRoundOutcome = {
			title: "Spies win",
			text: "Time expired before the non-spies finished the round.",
			everyoneWins: false,
		};
		this.players.forEach((player) => {
			player.timeoutGuessDone = false;
		});
		this.cancelInteractiveRoundState();
		this.roundPhase = "timeout-guess";
		if (this.getPendingGuessers().length === 0) {
			this.finishRoundWithOutcome(this.pendingRoundOutcome);
			return;
		}
		this.sendNewStateToAllPlayers();
	};

	startRevealedSpyGuessPhase = () => {
		this.clearTimer();
		this.timeLeft = 0;
		this.timePaused = false;
		this.pendingRoundOutcome = {
			title: "Everyone wins",
			text: "All spies have been revealed.",
			everyoneWins: true,
		};
		this.players.forEach((player) => {
			player.timeoutGuessDone = false;
		});
		this.cancelInteractiveRoundState();
		this.roundPhase = "revealed-spy-guess";
		if (this.getPendingGuessers().length === 0) {
			this.finishRoundWithOutcome(this.pendingRoundOutcome);
			return;
		}
		this.sendNewStateToAllPlayers();
	};

	maybeFinalizeGuessPhase = () => {
		if (!this.isSpyGuessPhase() || !this.pendingRoundOutcome) return;
		if (this.getPendingGuessers().length > 0) return;
		this.finishRoundWithOutcome(this.pendingRoundOutcome);
	};

	completeTimeoutGuessing = (player) => {
		if (!this.canParticipateInGuessPhase(player)) return;
		player.timeoutGuessDone = true;
		this.maybeFinalizeGuessPhase();
		if (this.isSpyGuessPhase()) {
			this.sendNewStateToAllPlayers();
		}
	};

	endTimeoutGuessPhase = (player) => {
		if (!this.isAdmin(player)) {
			this.emitUnauthorized(player.socket);
			return;
		}
		if (!this.isSpyGuessPhase() || !this.pendingRoundOutcome) return;
		this.finishRoundWithOutcome(this.pendingRoundOutcome);
	};

	startTimer = () => {
		this.clearTimer();
		this.timeLeft = this.settings.timeLimit * 60;
		if (this.timeLeft <= 0) return;
		this.timer = setInterval(() => {
			if (this.timePaused) return;
			this.timeLeft--;
			if (this.timeLeft > 0) return;
			this.timeLeft = 0;
			this.clearTimer();
			this.handleRoundTimerExpired();
		}, 1000);
	};

	clearTimer = () => {
		if (!this.timer) return;
		clearInterval(this.timer);
		this.timer = null;
	};

	clearQuestionTimeout = () => {
		if (!this.questionTimeout) return;
		clearTimeout(this.questionTimeout);
		this.questionTimeout = null;
	};

	clearPreRoundDelay = () => {
		if (!this.preRoundDelayTimeout) return;
		clearTimeout(this.preRoundDelayTimeout);
		this.preRoundDelayTimeout = null;
	};

	togglePauseTimer = (player) => {
		if (!this.isAdmin(player)) {
			this.emitUnauthorized(player.socket);
			return;
		}
		if (!this.isRoundActive() || this.timeLeft === null || this.timeLeft <= 0) {
			return;
		}
		this.timePaused = !this.timePaused;
		this.sendNewStateToAllPlayers();
	};

	updateSettings = (player, partialSettings = {}) => {
		if (!this.isAdmin(player)) {
			this.emitUnauthorized(player.socket);
			return;
		}
		if (this.status === "ingame") {
			this.emitActionError(
				player.socket,
				"Room settings can only be changed in the lobby.",
			);
			return;
		}

		const nextSettings = {
			...this.settings,
			...pickDefinedKeys(partialSettings, [
				"wordpack",
				"timeLimit",
				"includeAllSpy",
				"allowSpyRefusal",
				"spyCountMin",
				"spyCountMax",
				"spyCountDistribution",
				"customWordsEnabled",
				"customWordsText",
				"customSubsetSize",
				"autoEndWhenAllSpiesRevealed",
				"answerFlipChancePercent",
				"spyGuessLimit",
				"questionResponseSeconds",
			]),
		};

		this.settings = this.normalizeSettings(nextSettings);
		this.sendNewStateToAllPlayers();
	};

	normalizeSettings = (inputSettings = this.settings) => {
		const availablePackIds = new Set(
			Wordpacks.AVAILABLE_WORDPACKS.map(({ id }) => id),
		);
		const playerCap =
			Math.max(
				this.players.filter((player) => !player.manualObserver).length,
				2,
			) - 1;
		const safePlayerCap = Math.max(1, playerCap);

		const nextSettings = {
			wordpack: availablePackIds.has(inputSettings.wordpack)
				? inputSettings.wordpack
				: "Spyfall1",
			timeLimit: clamp(parseInteger(inputSettings.timeLimit, 8), 0, 60),
			includeAllSpy: Boolean(inputSettings.includeAllSpy),
			allowSpyRefusal: Boolean(inputSettings.allowSpyRefusal),
			spyCountMin: clamp(
				parseInteger(inputSettings.spyCountMin, 0),
				0,
				safePlayerCap,
			),
			spyCountMax: clamp(
				parseInteger(inputSettings.spyCountMax, 1),
				0,
				safePlayerCap,
			),
			spyCountDistribution:
				inputSettings.spyCountDistribution === "geometric"
					? "geometric"
					: "uniform",
			customWordsEnabled: Boolean(inputSettings.customWordsEnabled),
			customWordsText: String(inputSettings.customWordsText || "")
				.slice(0, MAX_CUSTOM_WORDS_TEXT_LENGTH)
				.replace(/\r/g, ""),
			customSubsetSize: clamp(
				parseInteger(inputSettings.customSubsetSize, 12),
				2,
				100,
			),
			autoEndWhenAllSpiesRevealed: Boolean(
				inputSettings.autoEndWhenAllSpiesRevealed,
			),
			answerFlipChancePercent: clamp(
				parseInteger(inputSettings.answerFlipChancePercent, 10),
				0,
				100,
			),
			spyGuessLimit: clamp(parseInteger(inputSettings.spyGuessLimit, 2), 0, 20),
			accusationsPerPlayer: 1,
			questionResponseSeconds: normalizeQuestionResponseSeconds(
				inputSettings.questionResponseSeconds,
			),
		};

		if (nextSettings.spyCountMin > nextSettings.spyCountMax) {
			const sorted = [nextSettings.spyCountMin, nextSettings.spyCountMax].sort(
				(a, b) => a - b,
			);
			nextSettings.spyCountMin = sorted[0];
			nextSettings.spyCountMax = sorted[1];
		}

		this.settings = nextSettings;
		return nextSettings;
	};

	submitQuestionPrompt = (player, payload = {}) => {
		if (!this.canPlayerAskQuestion(player)) return;
		if (
			this.activeQuestion ||
			this.accusationPhase ||
			this.activeAccusationVote
		) {
			this.emitActionError(
				player.socket,
				"Finish the current interaction first.",
			);
			return;
		}

		const targetName = sanitizeName(payload.targetName);
		const optionOne = sanitizeFreeText(payload.optionOne, MAX_QUESTION_LENGTH);
		const optionTwo = sanitizeFreeText(payload.optionTwo, MAX_QUESTION_LENGTH);
		const targetPlayer = this.findPlayerByName(targetName);

		if (!this.canPlayerBeQuestionTarget(player, targetPlayer)) {
			this.emitActionError(player.socket, "Choose another connected player.");
			return;
		}
		if (!optionOne || !optionTwo) {
			this.emitActionError(player.socket, "Enter 2 question options.");
			return;
		}

		const questionId = `q-${Date.now()}-${Math.random().toString(16).slice(2)}`;
		const expiresAt = this.settings.questionResponseSeconds
			? Date.now() + this.settings.questionResponseSeconds * 1000
			: null;
		this.activeQuestion = {
			id: questionId,
			askerAuthToken: player.authToken,
			askerName: player.name,
			targetAuthToken: targetPlayer.authToken,
			targetName: targetPlayer.name,
			options: [optionOne, optionTwo],
			expiresAt,
		};

		this.clearQuestionTimeout();
		if (expiresAt) {
			this.questionTimeout = setTimeout(
				() => this.handleQuestionTimeout(questionId),
				Math.max(0, expiresAt - Date.now()),
			);
		}

		this.sendNewStateToAllPlayers();
	};

	handleQuestionTimeout = (questionId) => {
		if (!this.activeQuestion || this.activeQuestion.id !== questionId) return;
		this.finalizeQuestion(null, "timeout");
	};

	chooseQuestionOption = (player, questionIndex) => {
		if (!this.isRoundActive()) return;
		if (!this.activeQuestion) return;
		if (player.authToken !== this.activeQuestion.targetAuthToken) return;
		if (!this.canPlayerBeQuestionTarget(null, player, { allowSelf: true }))
			return;

		const nextIndex = parseInteger(questionIndex, -1);
		if (nextIndex !== 0 && nextIndex !== 1) return;
		this.finalizeQuestion(nextIndex, "answered");
	};

	finalizeQuestion = (selectedIndex, outcome) => {
		if (!this.activeQuestion) return;
		const question = this.activeQuestion;
		this.clearQuestionTimeout();

		let recordedChoiceIndex = null;
		let recordedChoiceText = null;
		if (outcome === "answered") {
			recordedChoiceIndex = selectedIndex;
			if (
				this.settings.answerFlipChancePercent > 0 &&
				Math.random() * 100 < this.settings.answerFlipChancePercent
			) {
				recordedChoiceIndex = recordedChoiceIndex === 0 ? 1 : 0;
			}
			recordedChoiceText = question.options[recordedChoiceIndex];
		}

		this.questionHistory.push({
			askerAuthToken: question.askerAuthToken,
			askerName: question.askerName,
			targetAuthToken: question.targetAuthToken,
			targetName: question.targetName,
			options: question.options,
			recordedChoiceIndex,
			recordedChoiceText,
			outcome,
		});

		this.activeQuestion = null;
		this.refreshSuggestedQuestionTurn(question.askerAuthToken);
		this.sendNewStateToAllPlayers();
	};

	refreshSuggestedQuestionTurn = (
		afterAuthToken = null,
		{ useExact = false } = {},
	) => {
		const eligibleAskers = this.getEligibleQuestionAskers();
		if (eligibleAskers.length === 0) {
			this.questionTurn = {
				suggestedAskerAuthToken: null,
				suggestedTargetAuthToken: null,
			};
			return;
		}

		let suggestedAsker = null;
		if (useExact && afterAuthToken) {
			suggestedAsker = eligibleAskers.find(
				(player) => player.authToken === afterAuthToken,
			);
		}
		if (!suggestedAsker) {
			suggestedAsker = pickRandomLeastUsedPlayer(
				eligibleAskers,
				(player) => this.getQuestionAskCount(player),
			);
		}

		const eligibleTargets =
			this.getEligibleQuestionTargetsForPlayer(suggestedAsker);
		const suggestedTarget =
			eligibleTargets.length > 0
				? pickRandomLeastUsedPlayer(
						eligibleTargets,
						(player) => this.getQuestionAnswerCount(player),
					)
				: null;

		this.questionTurn = {
			suggestedAskerAuthToken: suggestedAsker?.authToken || null,
			suggestedTargetAuthToken: suggestedTarget?.authToken || null,
		};
	};

	getEligibleQuestionAskers = () =>
		this.players.filter((player) => this.canPlayerAskQuestion(player));

	getEligibleQuestionTargetsForPlayer = (asker) =>
		this.players.filter((player) =>
			this.canPlayerBeQuestionTarget(asker, player),
		);

	getQuestionAskCount = (player) =>
		this.questionHistory.filter(
			(entry) => entry.askerAuthToken === player.authToken,
		).length;

	getQuestionAnswerCount = (player) =>
		this.questionHistory.filter(
			(entry) =>
				entry.targetAuthToken === player.authToken &&
				entry.outcome === "answered",
		).length;

	canPlayerAskQuestion = (player) =>
		Boolean(
			this.isRoundActive() &&
				player &&
				player.connected &&
				player.name &&
				!player.manualObserver &&
				!player.observer &&
				player.revealedSpyStatus !== "spy",
		);

	canPlayerBeQuestionTarget = (
		asker,
		targetPlayer,
		{ allowSelf = false } = {},
	) =>
		Boolean(
			targetPlayer &&
				targetPlayer.connected &&
				targetPlayer.name &&
				!targetPlayer.manualObserver &&
				!targetPlayer.observer &&
				targetPlayer.revealedSpyStatus !== "spy" &&
				(allowSelf || !asker || targetPlayer.authToken !== asker.authToken),
		);

	canPlayerVote = (player) =>
		Boolean(
			player &&
				player.connected &&
				player.name &&
				!player.manualObserver &&
				player.revealedSpyStatus !== "spy" &&
				(!player.observer || player.revealedSpyStatus === "not-spy"),
		);

	canStartPlayerAccusation = (player) =>
		Boolean(
			this.isRoundActive() &&
				player &&
				player.connected &&
				player.name &&
				!player.manualObserver &&
				!player.observer &&
				player.revealedSpyStatus !== "spy" &&
				player.accusationsRemaining > 0,
		);

	canBePlayerAccusationTarget = (player) =>
		Boolean(
			player &&
				player.connected &&
				player.name &&
				!player.manualObserver &&
				!player.observer &&
				!player.revealedSpyStatus,
		);

	startPlayerAccusation = (player, targetName) => {
		if (!this.canStartPlayerAccusation(player)) return;
		if (this.activeQuestion || this.activeAccusationVote) {
			this.emitActionError(
				player.socket,
				"Finish the current interaction first.",
			);
			return;
		}

		const targetPlayer = this.findPlayerByName(sanitizeName(targetName));
		if (
			!this.canBePlayerAccusationTarget(targetPlayer) ||
			targetPlayer === player
		) {
			this.emitActionError(player.socket, "Choose another active player.");
			return;
		}

		player.accusationsRemaining = Math.max(0, player.accusationsRemaining - 1);
		this.startAccusationVote({
			mode: "player",
			targetType: "player",
			targetPlayer,
			initiator: player,
		});
	};

	submitPlayerAccusation = () => {};

	passAccusationTurn = () => {};

	startTerminalAccusation = (player, targetType) => {
		if (!this.canStartPlayerAccusation(player)) return;
		if (this.activeQuestion || this.activeAccusationVote) {
			this.emitActionError(
				player.socket,
				"Finish the current interaction first.",
			);
			return;
		}
		if (targetType !== "no-spy" && targetType !== "everyone-remaining-spy") {
			return;
		}
		player.accusationsRemaining = Math.max(0, player.accusationsRemaining - 1);
		this.startAccusationVote({
			mode: "terminal",
			targetType,
			initiator: player,
		});
	};

	startAccusationVote = ({ mode, targetType, targetPlayer = null, initiator }) => {
		const eligibleVoters = this.players
			.filter((player) => {
				if (!this.canPlayerVote(player)) return false;
				if (player.authToken === initiator.authToken) return false;
				if (targetPlayer && player.authToken === targetPlayer.authToken)
					return false;
				return true;
			})
			.map((player) => player.authToken);

		this.activeAccusationVote = {
			mode,
			targetType,
			targetAuthToken: targetPlayer?.authToken || null,
			targetName: targetPlayer?.name || getAccusationLabel(targetType),
			initiatedByAuthToken: initiator.authToken,
			initiatedByName: initiator.name,
			eligibleVoterAuthTokens: eligibleVoters,
			votes: {},
		};
		this.appendAccusationLog(
			mode === "terminal"
				? `${initiator.name} called a vote on ${this.activeAccusationVote.targetName}.`
				: `${initiator.name} accused ${this.activeAccusationVote.targetName}. Vote started.`,
		);
		this.maybeFinalizeAccusationVote();
		this.sendNewStateToAllPlayers();
	};

	voteAccusation = (player, voteValue) => {
		if (!this.activeAccusationVote) return;
		if (
			!this.activeAccusationVote.eligibleVoterAuthTokens.includes(
				player.authToken,
			)
		) {
			return;
		}
		if (this.activeAccusationVote.votes[player.authToken] !== undefined) return;
		this.activeAccusationVote.votes[player.authToken] = Boolean(voteValue);
		this.appendAccusationLog(
			`${player.name} voted ${voteValue ? "yes" : "no"} on ${this.activeAccusationVote.targetName}.`,
		);
		this.maybeFinalizeAccusationVote();
		this.sendNewStateToAllPlayers();
	};

	maybeFinalizeAccusationVote = () => {
		if (!this.activeAccusationVote) return;
		const total = this.activeAccusationVote.eligibleVoterAuthTokens.length;
		const yesVotes = Object.values(this.activeAccusationVote.votes).filter(
			Boolean,
		).length;
		const noVotes = Object.values(this.activeAccusationVote.votes).filter(
			(value) => value === false,
		).length;
		const pendingVotes = total - yesVotes - noVotes;

		if (
			yesVotes > total / 2 ||
			yesVotes + pendingVotes <= total / 2 ||
			pendingVotes === 0
		) {
			this.finalizeAccusationVote({ yesVotes, noVotes, total });
		}
	};

	finalizeAccusationVote = ({ yesVotes, noVotes, total }) => {
		if (!this.activeAccusationVote) return;
		const vote = this.activeAccusationVote;
		const passed = yesVotes > total / 2;
		this.activeAccusationVote = null;
		this.appendAccusationLog(
			`Vote on ${vote.targetName} ${passed ? "passed" : "failed"} (${yesVotes} yes, ${noVotes} no).`,
		);

		if (vote.mode === "terminal") {
			if (passed) {
				const verdict = this.evaluateTerminalAccusation(vote.targetType);
				this.finishRoundWithOutcome(verdict);
				return;
			}
			this.sendNewStateToAllPlayers();
			return;
		}

		if (!passed || !vote.targetAuthToken) {
			this.sendNewStateToAllPlayers();
			return;
		}
		const targetPlayer = this.findPlayerByAuthToken(vote.targetAuthToken);
		if (!this.canBePlayerAccusationTarget(targetPlayer)) {
			this.sendNewStateToAllPlayers();
			return;
		}
		this.resolveAccusationTarget(targetPlayer);
		this.sendNewStateToAllPlayers();
	};

	resolveAccusationTarget = (targetPlayer) => {
		if (targetPlayer.role === "spy") {
			targetPlayer.revealedSpyStatus = "spy";
			targetPlayer.canBePromoted = false;
			this.appendAccusationLog(`${targetPlayer.name} was revealed as a spy.`);
			this.refreshSuggestedQuestionTurn(targetPlayer.authToken);
			if (this.maybeAutoEndWhenAllSpiesRevealed()) return;
			return;
		}

		targetPlayer.observer = true;
		targetPlayer.observerReason = "accusation-not-spy";
		targetPlayer.revealedSpyStatus = "not-spy";
		targetPlayer.canBePromoted = false;
		targetPlayer.isFirst = false;
		this.appendAccusationLog(
			`${targetPlayer.name} was not a spy and is out of the round.`,
		);
		this.cleanupInteractiveStateForPlayer(targetPlayer);
		this.refreshSuggestedQuestionTurn(targetPlayer.authToken);
	};

	evaluateTerminalAccusation = (targetType) => {
		if (targetType === "no-spy") {
			const success = this.countUnrevealedSpies() === 0;
			return {
				title: success ? "Everyone wins" : "Everyone loses",
				text: success
					? "The No Spy accusation was correct."
					: "The No Spy accusation was incorrect.",
				everyoneWins: success,
			};
		}

		const remainingPlayers = this.players.filter(
			(player) =>
				player.connected &&
				player.name &&
				!player.manualObserver &&
				!player.observer,
		);
		const success =
			remainingPlayers.length > 0 &&
			remainingPlayers.every((player) => player.role === "spy");
		return {
			title: success ? "Everyone wins" : "Everyone loses",
			text: success
				? "Everyone remaining in the round was a spy."
				: "Not everyone remaining in the round was a spy.",
			everyoneWins: success,
		};
	};

	submitSpyGuess = (player, guessWordId) => {
		if (!this.canPlayerSubmitSpyGuess(player)) return;

		const cleanGuess = sanitizeFreeText(guessWordId, MAX_GUESS_LENGTH);
		if (!cleanGuess) {
			this.emitActionError(player.socket, "Choose a guess.");
			return;
		}

		player.guessesRemaining = Math.max(0, player.guessesRemaining - 1);
		if (this.word && cleanGuess === this.word.id) {
			player.revealedSpyStatus = "spy";
			player.canBePromoted = false;
			this.clearTimer();
			this.timePaused = false;
			this.cancelInteractiveRoundState();
			this.finishRoundWithOutcome({
				title: "Spies win",
				text: `${player.name} guessed the ${this.getRevealKind()} correctly.`,
				everyoneWins: false,
			});
			return;
		}

		if (this.isSpyGuessPhase()) {
			this.maybeFinalizeGuessPhase();
			if (!this.isSpyGuessPhase()) return;
		}

		this.sendNewStateToAllPlayers();
	};

	countUnrevealedSpies = () =>
		this.players.filter(
			(player) =>
				player.connected &&
				player.name &&
				!player.manualObserver &&
				player.role === "spy" &&
				player.revealedSpyStatus !== "spy",
		).length;

	maybeAutoEndWhenAllSpiesRevealed = () => {
		if (!this.settings.autoEndWhenAllSpiesRevealed) return false;
		if (this.currentRoundSpyCount <= 0) return false;
		if (this.countUnrevealedSpies() > 0) return false;
		if (
			this.players.some(
				(player) =>
					player.connected &&
					player.name &&
					!player.manualObserver &&
					!player.observer &&
					player.role === "spy" &&
					player.revealedSpyStatus === "spy" &&
					player.guessesRemaining > 0,
			)
		) {
			this.startRevealedSpyGuessPhase();
			return true;
		}

		this.finishRoundWithOutcome({
			title: "Everyone wins",
			text: "All spies have been revealed.",
			everyoneWins: true,
		});
		return true;
	};

	kickPlayerByName = (actor, theName) => {
		if (!this.isAdmin(actor)) {
			this.emitUnauthorized(actor.socket);
			return;
		}
		if (!this.isRoundActive()) {
			this.emitActionError(
				actor.socket,
				"Players can only be kicked during an active round.",
			);
			return;
		}

		const player = this.findPlayerByName(theName);
		if (
			!player ||
			!player.connected ||
			!player.name ||
			player.manualObserver ||
			player.observer
		) {
			this.emitActionError(actor.socket, "Choose another active player.");
			return;
		}
		if (player === actor) {
			this.emitActionError(actor.socket, "You cannot kick yourself.");
			return;
		}

		this.kickPlayer(player);
		if (
			player.revealedSpyStatus === "spy" &&
			this.maybeAutoEndWhenAllSpiesRevealed()
		) {
			return;
		}
		this.sendNewStateToAllPlayers();
	};

	kickPlayer = (player) => {
		this.cleanupInteractiveStateForPlayer(player);
		player.observer = true;
		player.observerReason = "admin-kick";
		player.isFirst = false;
		player.revealedSpyStatus = player.role === "spy" ? "spy" : "not-spy";
		player.canBePromoted = player.revealedSpyStatus !== "spy";
		this.reconcileAccusationState();
		this.refreshSuggestedQuestionTurn(player.authToken);
	};

	promoteObserverByName = (actor, theName) => {
		if (!this.isAdmin(actor)) {
			this.emitUnauthorized(actor.socket);
			return;
		}
		if (!this.isRoundActive()) {
			this.emitActionError(
				actor.socket,
				"Observers can only be promoted during a round.",
			);
			return;
		}

		const player = this.findPlayerByName(theName);
		if (
			!player ||
			!player.connected ||
			!player.observer ||
			player.manualObserver
		)
			return;
		if (!player.canBePromoted) {
			this.emitActionError(
				actor.socket,
				"This player cannot rejoin the round.",
			);
			return;
		}

		this.promoteObserver(player);
		this.sendNewStateToAllPlayers();
	};

	promoteObserver = (player) => {
		player.observer = false;
		player.observerReason = null;
		player.isFirst = false;
		player.canBePromoted = true;
		player.role = null;
		this.maybeFinalizeGuessPhase();
		this.reconcileAccusationState();
		this.refreshSuggestedQuestionTurn(player.authToken);
	};

	togglePlayerObserverByName = (actor, theName) => {
		if (!this.isAdmin(actor)) {
			this.emitUnauthorized(actor.socket);
			return;
		}
		const player = this.findPlayerByName(theName);
		if (!player) return;
		if (!player.connected) return;

		player.manualObserver = !player.manualObserver;
		if (player.manualObserver) {
			this.cleanupInteractiveStateForPlayer(player);
			player.observer = true;
			player.observerReason = "manual";
			player.role = null;
			player.isFirst = false;
		} else if (this.status === "ingame") {
			player.observer = false;
			player.observerReason = null;
			player.revealedSpyStatus = null;
			player.role = null;
			player.guessesRemaining = 0;
			player.accusationsRemaining = 1;
		}

		this.normalizeSettings();
		this.checkIfReady();
		this.maybeFinalizeGuessPhase();
		this.reconcileAccusationState();
		this.refreshSuggestedQuestionTurn(player.authToken);
		this.sendNewStateToAllPlayers();
	};

	getParsedCustomWords = () => {
		const uniqueWords = new Set();
		const words = [];
		for (const line of this.settings.customWordsText.split("\n")) {
			const cleanLine = sanitizeFreeText(line, 80);
			if (!cleanLine || uniqueWords.has(cleanLine)) continue;
			uniqueWords.add(cleanLine);
			words.push({
				id: `custom:${words.length}`,
				label: cleanLine,
			});
		}
		return words;
	};

	getValidatedSpyRange = (playerCount) => {
		const maxSpyCount = Math.max(0, playerCount - 1);
		let min = clamp(this.settings.spyCountMin, 0, maxSpyCount);
		let max = clamp(this.settings.spyCountMax, 0, maxSpyCount);
		if (min > max) {
			[min, max] = [max, min];
		}
		return { min, max };
	};

	getRoundSetupPlayers = () =>
		this.players.filter(
			(player) => player.name && player.connected && !player.manualObserver,
		);

	getRoundPlayers = () =>
		this.players.filter(
			(player) =>
				player.name &&
				player.connected &&
				!player.manualObserver &&
				!player.observer,
		);

	isRoundActive = () =>
		this.status === "ingame" && this.roundPhase === "active";

	isCreator = (player) =>
		Boolean(
			player &&
				player.authToken &&
				this.creatorAuthToken &&
				player.authToken === this.creatorAuthToken,
		);

	isAdmin = (player) => {
		if (!player || !player.authToken) return false;
		if (this.isCreator(player)) return Boolean(player.connected);
		if (this.creatorPlayerConnected()) return false;
		return this.tempAdminAuthTokens.has(player.authToken);
	};

	emitUnauthorized = (socket) =>
		this.emitActionError(socket, "Only the current admin can do that.");

	emitActionError = (socket, message) => {
		if (!socket) return;
		socket.emit("actionError", message);
	};

	emitActionErrorToAll = (message) => {
		for (const player of this.players) {
			if (!player.socket || !player.connected) continue;
			this.emitActionError(player.socket, message);
		}
	};

	getVisibleWordForPlayer = (player) => {
		if (this.status !== "ingame") {
			return this.getLocalizedWordForPlayer(player, this.word);
		}
		if (
			!this.isRoundActive() &&
			this.roundPhase !== "timeout-guess" &&
			this.roundPhase !== "revealed-spy-guess"
		)
			return null;
		if (
			!this.word ||
			player.role === "spy" ||
			player.manualObserver ||
			player.observer
		)
			return null;
		return this.getLocalizedWordForPlayer(player, this.word);
	};

	getVisibleWordListForPlayer = (player) => {
		if (this.status !== "ingame") {
			return this.getLocalizedWordListForPlayer(player, this.wordList);
		}
		if (
			!this.isRoundActive() &&
			this.roundPhase !== "timeout-guess" &&
			this.roundPhase !== "revealed-spy-guess"
		)
			return [];
		return this.getLocalizedWordListForPlayer(player, this.wordList);
	};

	getSettingsForPlayer = (player) => {
		const settings = { ...this.settings };
		if (!this.isAdmin(player)) {
			delete settings.customWordsText;
		}
		return settings;
	};

	getQuestionTurnForPlayer = () => {
		const suggestedAsker = this.findPlayerByAuthToken(
			this.questionTurn.suggestedAskerAuthToken,
		);
		const suggestedTarget = this.findPlayerByAuthToken(
			this.questionTurn.suggestedTargetAuthToken,
		);
		return {
			suggestedAskerName: suggestedAsker?.name || null,
			suggestedTargetName: suggestedTarget?.name || null,
		};
	};

	getAccusationPhaseForPlayer = () => {
		return null;
	};

	getActiveAccusationVoteForPlayer = (player) => {
		if (!this.activeAccusationVote) return null;
		const yesVotes = Object.values(this.activeAccusationVote.votes).filter(
			Boolean,
		).length;
		const noVotes = Object.values(this.activeAccusationVote.votes).filter(
			(value) => value === false,
		).length;
		const totalVotes = this.activeAccusationVote.eligibleVoterAuthTokens.length;
		return {
			mode: this.activeAccusationVote.mode,
			targetType: this.activeAccusationVote.targetType,
			targetName: this.activeAccusationVote.targetName,
			initiatedByName: this.activeAccusationVote.initiatedByName,
			yesVotes,
			noVotes,
			pendingVotes: totalVotes - yesVotes - noVotes,
			eligibleToVote:
				this.activeAccusationVote.eligibleVoterAuthTokens.includes(
					player.authToken,
				),
			myVote:
				this.activeAccusationVote.votes[player.authToken] === undefined
					? null
					: this.activeAccusationVote.votes[player.authToken],
		};
	};

	getStateForPlayer = (player) => {
		const privateInfo = {
			...player.getPrivateInfo(this.isCreator(player), this.isAdmin(player)),
			canVote: this.canPlayerVote(player),
		};
		if (this.roundPhase === "zero-spy-delay") {
			privateInfo.role = null;
		}

		return {
			code: this.code,
			players: this.getPlayers(),
			status: this.status,
			roundPhase: this.roundPhase,
			roundMode: this.roundMode,
			word: this.getVisibleWordForPlayer(player),
			wordList: this.getVisibleWordListForPlayer(player),
			spyOffer: this.getSpyOfferForPlayer(player),
			timeLeft: this.timeLeft,
			timePaused: this.timePaused,
			settings: this.getSettingsForPlayer(player),
			AVAILABLE_WORDPACKS: Wordpacks.AVAILABLE_WORDPACKS,
			currentRoundNum: this.currentRoundNum,
			questionHistory: this.questionHistory,
			accusationLog: this.accusationLog,
			activeQuestion: this.activeQuestion
				? {
						id: this.activeQuestion.id,
						askerName: this.activeQuestion.askerName,
						targetName: this.activeQuestion.targetName,
						options: this.activeQuestion.options,
						expiresAt: this.activeQuestion.expiresAt,
					}
				: null,
			questionTurn: this.getQuestionTurnForPlayer(),
			accusationPhase: this.getAccusationPhaseForPlayer(),
			activeAccusationVote: this.getActiveAccusationVoteForPlayer(player),
			me: privateInfo,
		};
	};

	getPlayers = () =>
		this.players.map((player) => ({
			...player.getPublicInfo(this.isCreator(player), this.isAdmin(player)),
			canVote: this.canPlayerVote(player),
		}));
}

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const parseInteger = (value, fallback) => {
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeQuestionResponseSeconds = (value) => {
	const parsed = clamp(parseInteger(value, 0), 0, 300);
	if (parsed === 0) return 0;
	return Math.max(MIN_QUESTION_RESPONSE_SECONDS, parsed);
};

const randomIntInclusive = (min, max) =>
	Math.floor(Math.random() * (max - min + 1)) + min;

const sanitizeName = (value) =>
	String(value || "")
		.trim()
		.replace(/\s+/g, " ")
		.slice(0, 24);

const sanitizeFreeText = (value, maxLength) =>
	String(value || "")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, maxLength);

const pickDefinedKeys = (source, keys) =>
	keys.reduce((result, key) => {
		if (source[key] !== undefined) {
			result[key] = source[key];
		}
		return result;
	}, {});

const shuffleArray = (array) => {
	for (let i = array.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[array[i], array[j]] = [array[j], array[i]];
	}
	return array;
};

const pickRandomLeastUsedPlayer = (players, getScore) => {
	if (!players.length) return null;
	let lowestScore = Infinity;
	const candidates = [];
	for (const player of players) {
		const score = getScore(player);
		if (score < lowestScore) {
			lowestScore = score;
			candidates.length = 0;
			candidates.push(player);
			continue;
		}
		if (score === lowestScore) {
			candidates.push(player);
		}
	}
	return candidates[Math.floor(Math.random() * candidates.length)] || null;
};

const normalizeWordEntry = (word) => {
	if (!word) return null;
	if (typeof word === "string") {
		return {
			id: word,
			label: word,
		};
	}

	const label =
		typeof word.label === "string"
			? word.label
			: typeof word.defaultLabel === "string"
				? word.defaultLabel
				: String(word.id || "");

	return {
		id: String(word.id || label),
		label,
	};
};

const getAccusationLabel = (targetType) => {
	if (targetType === "no-spy") return "No Spy";
	if (targetType === "everyone-remaining-spy")
		return "Everyone Remaining is a Spy";
	return "Accusation";
};

module.exports = Game;
