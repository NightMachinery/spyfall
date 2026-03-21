const Player = require("./Player");

const Locations = require("./Locations");

const DISCONNECTED_PLAYER_TTL_MS = 2 * 60 * 1000;
const MAX_CUSTOM_WORDS_TEXT_LENGTH = 20000;
const MAX_QUESTION_LENGTH = 160;
const MAX_ANSWER_LENGTH = 300;

class Game {
	constructor(code, onEmpty, getMinutesUntilRestart) {
		this.code = code;
		this.onEmpty = onEmpty;

		this.locked = false;
		this.getMinutesUntilRestart = getMinutesUntilRestart;

		this.players = [];
		this.creatorAuthToken = null;
		this.status = "lobby-waiting"; // lobby-waiting, lobby-ready, ingame
		this.roundMode = "pack";
		this.location = null;
		this.locationList = [];
		this.timeLeft = null;
		this.timePaused = false;
		this.currentRoundNum = 0;
		this.questionHistory = [];
		this.activeQuestion = null;
		this.timer = null;
		this.settings = {
			locationPack: "spyfall1",
			timeLimit: 8, // 8 minutes
			includeAllSpy: false,
			spyCountMin: 1,
			spyCountMax: 1,
			spyCountDistribution: "uniform",
			customWordsEnabled: false,
			customWordsText: "",
			customSubsetSize: 12,
		};

		// delete this game if it does not have players after 60 seconds
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

	initPlayer(socket, authToken) {
		const player = this.addPlayer(socket, authToken);
		this.attachListenersToPlayer(player);

		this.normalizeSettings();
		this.checkIfReady();
		this.sendNewStateToAllPlayers();
	}

	addPlayer(socket, authToken) {
		const resolvedAuthToken = this.resolveAuthToken(socket, authToken);
		const playerToReplace = this.findPlayerByAuthToken(resolvedAuthToken);

		if (playerToReplace) {
			return Game.replacePlayer(playerToReplace, socket);
		}

		return this.createPlayer(socket, resolvedAuthToken);
	}

	createPlayer(socket, authToken) {
		const newPlayer = new Player(socket, authToken);
		if (!this.creatorAuthToken) {
			this.creatorAuthToken = authToken;
		}

		this.players.push(newPlayer);

		if (this.status === "ingame") {
			this.createPlayerWhileInGame(newPlayer);
		}

		return newPlayer;
	}

	static replacePlayer(player, socket) {
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
		return player;
	}

	createPlayerWhileInGame(player) {
		if (!this.location) return;

		if (this.roundMode === "custom") {
			player.role = null;
			return;
		}

		if (this.location.isAllSpyLocation) {
			player.role = "spy";
			return;
		}

		const defaultRole =
			this.location.roles?.[this.location.roles.length - 1] || null;
		player.role = defaultRole;
	}

	findPlayerByAuthToken = (authToken) =>
		this.players.find((player) => player.authToken === authToken);

	removePlayerByName = (actor, theName) => {
		if (!this.isCreator(actor)) {
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

		if (this.status !== "ingame") {
			this.normalizeSettings();
			this.checkIfReady();
		}

		this.sendNewStateToAllPlayers();
		this.deleteGameIfEmpty();
	};

	scheduleDisconnectedPlayerCleanup = (player) => {
		player.clearDisconnectTimeout();
		player.disconnectTimeout = setTimeout(() => {
			if (player.connected) return;

			this.deletePlayer(player);
			this.cleanupQuestionStateForPlayer(player);
			this.normalizeSettings();
			this.checkIfReady();
			this.sendNewStateToAllPlayers();
			this.deleteGameIfEmpty();
		}, DISCONNECTED_PLAYER_TTL_MS);
	};

	deleteGameIfEmpty = () => {
		if (this.noPlayersLeft() && this.code !== "ffff") {
			this.clearTimer();
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
	};

	forceRemovePlayer = (player) => {
		player.clearDisconnectTimeout();
		this.cleanupQuestionStateForPlayer(player);

		if (player.socket) {
			player.socket.removeAllListeners();
			try {
				player.socket.disconnect(true);
			} catch (_error) {
				// no-op
			}
		}

		this.deletePlayer(player);
		this.deleteGameIfEmpty();
	};

	cleanupQuestionStateForPlayer = (player) => {
		if (!this.activeQuestion) return;

		if (
			this.activeQuestion.askerName === player.name ||
			this.activeQuestion.targetName === player.name
		) {
			this.activeQuestion = null;
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
		socket.on("removePlayer", (name) => this.removePlayerByName(player, name));
		socket.on("disconnect", this.handleDisconnect(player));
		socket.on("togglePause", () => this.togglePauseTimer(player));
		socket.on("endGame", () => this.endGame(player));
		socket.on("updateSettings", (settings) =>
			this.updateSettings(player, settings)
		);
		socket.on("clearName", () => this.clearName(player)());
		socket.on("submitQuestionPrompt", (payload) =>
			this.submitQuestionPrompt(player, payload)
		);
		socket.on("chooseQuestionOption", (questionIndex) =>
			this.chooseQuestionOption(player, questionIndex)
		);
		socket.on("submitQuestionAnswer", (answer) =>
			this.submitQuestionAnswer(player, answer)
		);
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

		const everyoneHasName =
			this.players.length >= 2 &&
			this.players.reduce(
				(answer, player) => Boolean(player.name) && answer,
				true
			);
		const everyoneConnected = this.players.reduce(
			(answer, player) => player.connected && answer,
			true
		);

		const isReady = everyoneHasName && everyoneConnected;
		this.status = isReady ? "lobby-ready" : "lobby-waiting";

		return isReady;
	};

	startGame = (player) => () => {
		if (!this.isCreator(player)) {
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

		this.startTimer();
		this.status = "ingame";
		this.currentRoundNum++;
		this.sendNewStateToAllPlayers();
	};

	prepareRound = (player) => {
		const roundPlayers = this.getRoundPlayers();
		if (roundPlayers.length < 2) {
			this.emitActionError(player.socket, "At least 2 connected players are required.");
			return false;
		}

		this.clearTimer();
		this.questionHistory = [];
		this.activeQuestion = null;
		this.players.forEach((thePlayer) => thePlayer.reset());

		const locationPicked = this.pickLocation(player);
		if (!locationPicked) return false;

		this.pickFirst(roundPlayers);

		if (this.location?.isAllSpyLocation) {
			this.setAllAsSpy(roundPlayers);
			return true;
		}

		const spyCount = this.pickSpyCount(roundPlayers.length);
		this.assignSpies(roundPlayers, spyCount);

		if (this.roundMode !== "custom") {
			this.assignRoles(roundPlayers);
		}

		return true;
	};

	endGame = (player) => {
		if (!this.isCreator(player)) {
			this.emitUnauthorized(player.socket);
			return;
		}

		this.status = "lobby-waiting";
		this.roundMode = "pack";
		this.location = null;
		this.locationList = [];
		this.timeLeft = null;
		this.timePaused = false;
		this.questionHistory = [];
		this.activeQuestion = null;
		this.clearTimer();

		this.removeDisconnectedPlayers();
		this.players.forEach((thePlayer) => thePlayer.reset());

		this.normalizeSettings();
		this.checkIfReady();
		this.sendNewStateToAllPlayers();
		this.deleteGameIfEmpty();
	};

	pickLocation = (player) => {
		if (this.settings.customWordsEnabled) {
			const allWords = this.getParsedCustomWords();
			if (allWords.length < 2) {
				this.emitActionError(
					player.socket,
					"Custom word mode needs at least 2 words."
				);
				return false;
			}

			const subsetSize = clamp(
				this.settings.customSubsetSize,
				2,
				allWords.length
			);
			const shuffledWords = shuffleArray(allWords.slice());
			const subset = shuffledWords.slice(0, subsetSize);
			const chosenWord =
				subset[Math.floor(Math.random() * subset.length)] || subset[0];

			this.roundMode = "custom";
			this.location = {
				name: chosenWord,
				isCustomWordsLocation: true,
			};
			this.locationList = subset;
			return true;
		}

		const { locationPack, includeAllSpy } = this.settings;
		const nextLocation = Locations.getRandomLocationFromPack(
			locationPack,
			includeAllSpy
		);

		if (!nextLocation) {
			this.emitActionError(player.socket, "That location pack is unavailable.");
			return false;
		}

		this.roundMode = "pack";
		this.location = nextLocation;
		this.locationList = Locations.getLocationListFromPack(
			locationPack,
			includeAllSpy
		);
		return true;
	};

	assignSpies = (players, spyCount) => {
		const shuffledPlayers = shuffleArray(players.slice());
		for (const player of shuffledPlayers.slice(0, spyCount)) {
			player.role = "spy";
		}
	};

	setAllAsSpy = (players) =>
		players.forEach((player) => {
			player.role = "spy";
		});

	pickFirst = (players) => {
		players[Math.floor(Math.random() * players.length)].isFirst = true;
	};

	assignRoles = (players) => {
		const defaultRole = this.location.roles[this.location.roles.length - 1];
		const roles = this.location.roles.slice();
		const shuffledRoles = shuffleArray(roles);

		players.forEach((player) => {
			if (player.role === "spy") return;

			const role = shuffledRoles.pop() || defaultRole;
			player.role = role;
		});
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
			if (randomWeight <= 0) {
				return values[i];
			}
		}

		return values[values.length - 1];
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
		}, 1000);
	};

	clearTimer = () => {
		if (!this.timer) return;
		clearInterval(this.timer);
		this.timer = null;
	};

	togglePauseTimer = (player) => {
		if (!this.isCreator(player)) {
			this.emitUnauthorized(player.socket);
			return;
		}

		if (this.status !== "ingame" || this.timeLeft === null || this.timeLeft <= 0) {
			return;
		}

		this.timePaused = !this.timePaused;
		this.sendNewStateToAllPlayers();
	};

	updateSettings = (player, partialSettings = {}) => {
		if (!this.isCreator(player)) {
			this.emitUnauthorized(player.socket);
			return;
		}

		if (this.status === "ingame") {
			this.emitActionError(player.socket, "Room settings can only be changed in the lobby.");
			return;
		}

		const nextSettings = {
			...this.settings,
			...pickDefinedKeys(partialSettings, [
				"locationPack",
				"timeLimit",
				"includeAllSpy",
				"spyCountMin",
				"spyCountMax",
				"spyCountDistribution",
				"customWordsEnabled",
				"customWordsText",
				"customSubsetSize",
			]),
		};

		this.settings = this.normalizeSettings(nextSettings);
		this.sendNewStateToAllPlayers();
	};

	normalizeSettings = (inputSettings = this.settings) => {
		const availablePackIds = new Set(
			Locations.AVAILABLE_LOCATION_PACKS.map(({ id }) => id)
		);
		const playerCap = Math.max(this.players.length, 2) - 1;
		const safePlayerCap = Math.max(1, playerCap);

		const nextSettings = {
			locationPack: availablePackIds.has(inputSettings.locationPack)
				? inputSettings.locationPack
				: "spyfall1",
			timeLimit: clamp(parseInteger(inputSettings.timeLimit, 8), 0, 60),
			includeAllSpy: Boolean(inputSettings.includeAllSpy),
			spyCountMin: clamp(parseInteger(inputSettings.spyCountMin, 1), 1, safePlayerCap),
			spyCountMax: clamp(parseInteger(inputSettings.spyCountMax, 1), 1, safePlayerCap),
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
				100
			),
		};

		if (nextSettings.spyCountMin > nextSettings.spyCountMax) {
			const sorted = [nextSettings.spyCountMin, nextSettings.spyCountMax].sort(
				(a, b) => a - b
			);
			nextSettings.spyCountMin = sorted[0];
			nextSettings.spyCountMax = sorted[1];
		}

		this.settings = nextSettings;
		return nextSettings;
	};

	submitQuestionPrompt = (player, payload = {}) => {
		if (this.status !== "ingame" || !player.name || !player.connected) return;
		if (this.activeQuestion) {
			this.emitActionError(player.socket, "Finish the current question first.");
			return;
		}

		const targetName = sanitizeName(payload.targetName);
		const optionOne = sanitizeFreeText(payload.optionOne, MAX_QUESTION_LENGTH);
		const optionTwo = sanitizeFreeText(payload.optionTwo, MAX_QUESTION_LENGTH);
		const targetPlayer = this.findPlayerByName(targetName);

		if (!targetPlayer || !targetPlayer.connected || targetPlayer === player) {
			this.emitActionError(player.socket, "Choose another connected player.");
			return;
		}

		if (!optionOne || !optionTwo) {
			this.emitActionError(player.socket, "Enter 2 question options.");
			return;
		}

		this.activeQuestion = {
			askerName: player.name,
			targetName: targetPlayer.name,
			options: [optionOne, optionTwo],
			selectedOptionIndex: null,
		};

		this.sendNewStateToAllPlayers();
	};

	chooseQuestionOption = (player, questionIndex) => {
		if (!this.activeQuestion) return;
		if (player.name !== this.activeQuestion.targetName) return;

		const nextIndex = parseInteger(questionIndex, -1);
		if (nextIndex !== 0 && nextIndex !== 1) return;

		this.activeQuestion.selectedOptionIndex = nextIndex;
		this.sendNewStateToAllPlayers();
	};

	submitQuestionAnswer = (player, answer) => {
		if (!this.activeQuestion) return;
		if (player.name !== this.activeQuestion.targetName) return;
		if (this.activeQuestion.selectedOptionIndex === null) return;

		const cleanAnswer = sanitizeFreeText(answer, MAX_ANSWER_LENGTH);
		if (!cleanAnswer) {
			this.emitActionError(player.socket, "Enter an answer.");
			return;
		}

		this.questionHistory.push({
			askerName: this.activeQuestion.askerName,
			targetName: this.activeQuestion.targetName,
			question:
				this.activeQuestion.options[this.activeQuestion.selectedOptionIndex],
			answer: cleanAnswer,
		});
		this.activeQuestion = null;
		this.sendNewStateToAllPlayers();
	};

	getParsedCustomWords = () => {
		const uniqueWords = new Set();
		const words = [];

		for (const line of this.settings.customWordsText.split("\n")) {
			const cleanLine = sanitizeFreeText(line, 80);
			if (!cleanLine || uniqueWords.has(cleanLine)) continue;
			uniqueWords.add(cleanLine);
			words.push(cleanLine);
		}

		return words;
	};

	getValidatedSpyRange = (playerCount) => {
		const maxSpyCount = Math.max(1, playerCount - 1);
		let min = clamp(this.settings.spyCountMin, 1, maxSpyCount);
		let max = clamp(this.settings.spyCountMax, 1, maxSpyCount);

		if (min > max) {
			[min, max] = [max, min];
		}

		return { min, max };
	};

	getRoundPlayers = () =>
		this.players.filter((player) => player.name && player.connected);

	isCreator = (player) =>
		Boolean(
			player &&
				player.authToken &&
				this.creatorAuthToken &&
				player.authToken === this.creatorAuthToken
		);

	emitUnauthorized = (socket) =>
		this.emitActionError(socket, "Only the room creator can do that.");

	emitActionError = (socket, message) => {
		if (!socket) return;
		socket.emit("actionError", message);
	};

	getVisibleLocationForPlayer = (player) => {
		if (this.status !== "ingame") return this.location;
		if (!this.location || player.role === "spy") return null;
		return this.location;
	};

	getSettingsForPlayer = (player) => {
		const settings = { ...this.settings };
		if (!this.isCreator(player)) {
			delete settings.customWordsText;
		}
		return settings;
	};

	getStateForPlayer = (player) => ({
		code: this.code,
		players: this.getPlayers(),
		status: this.status,
		roundMode: this.roundMode,
		location: this.getVisibleLocationForPlayer(player),
		locationList: this.locationList,
		timeLeft: this.timeLeft,
		timePaused: this.timePaused,
		settings: this.getSettingsForPlayer(player),
		AVAILABLE_LOCATION_PACKS: Locations.AVAILABLE_LOCATION_PACKS,
		currentRoundNum: this.currentRoundNum,
		questionHistory: this.questionHistory,
		activeQuestion: this.activeQuestion,
		me: player.getPrivateInfo(this.isCreator(player)),
	});

	getPlayers = () =>
		this.players.map((player) => player.getPublicInfo(this.isCreator(player)));
}

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const parseInteger = (value, fallback) => {
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) ? parsed : fallback;
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

// https://stackoverflow.com/a/6274381
const shuffleArray = (array) => {
	for (let i = array.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[array[i], array[j]] = [array[j], array[i]];
	}
	return array;
};

module.exports = Game;
