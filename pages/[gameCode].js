import React, { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/router";
import socketIOClient from "socket.io-client";
import Swal from "sweetalert2";
import { useCurrentLocale, useI18n } from "../locales";

import NameEntry from "../components/NameEntry";
import Lobby from "../components/Lobby";
import InGame from "../components/InGame";
import Loading from "../components/Loading";
import EventCueSettings from "../components/EventCueSettings";
import EventCueToastStack from "../components/EventCueToastStack";
import { lockedMessage } from "../utils/misc";
import {
	getSavedEventCuePreferences,
	setSavedEventCuePreferences,
} from "../utils/localEventCues";
import {
	getOrCreateAuthToken,
	getSavedDisplayName,
	setSavedDisplayName,
} from "../utils/localIdentity";

const socket = socketIOClient({
	autoConnect: false,
});

const CUE_PATTERNS = {
	questionTurns: [784, 988],
	accusationsVotes: [523, 659, 523],
	spyRoleEvents: [659, 880],
	roundLifecycle: [440, 554, 659],
	adminRoomNotices: [392, 330],
};

const playCuePattern = async (audioContext, groupId) => {
	const frequencies = CUE_PATTERNS[groupId] || CUE_PATTERNS.adminRoomNotices;
	await audioContext.resume();
	const baseTime = audioContext.currentTime + 0.01;

	frequencies.forEach((frequency, index) => {
		const oscillator = audioContext.createOscillator();
		const gainNode = audioContext.createGain();
		const startTime = baseTime + index * 0.14;
		const endTime = startTime + 0.1;

		oscillator.type = index % 2 === 0 ? "sine" : "triangle";
		oscillator.frequency.setValueAtTime(frequency, startTime);
		gainNode.gain.setValueAtTime(0.0001, startTime);
		gainNode.gain.linearRampToValueAtTime(0.045, startTime + 0.015);
		gainNode.gain.exponentialRampToValueAtTime(0.0001, endTime);

		oscillator.connect(gainNode);
		gainNode.connect(audioContext.destination);
		oscillator.start(startTime);
		oscillator.stop(endTime + 0.02);
	});
};

const getCueDetailForReveal = (revealedSpyStatus) => {
	if (revealedSpyStatus === "spy") {
		return "You can no longer ask or answer questions, but you may still use any remaining guesses.";
	}
	if (revealedSpyStatus === "not-spy") {
		return "You are out of the round, but can still observe and vote when allowed.";
	}
	return "";
};

const maybeEmitStateCues = (previousState, nextState, emitCue) => {
	if (!previousState || !nextState?.me) return;

	const previousMe = previousState.me || {};
	const nextMe = nextState.me || {};

	if (
		nextState.currentRoundNum !== previousState.currentRoundNum &&
		nextState.status === "ingame"
	) {
		if (nextState.roundPhase === "zero-spy-delay") {
			emitCue(
				"roundLifecycle",
				"Round starting",
				"Clues are being held briefly before the round opens.",
			);
		} else if (nextState.roundPhase === "offering-spies") {
			emitCue(
				"roundLifecycle",
				"Round starting",
				"Spy offers are being finalized before clues are revealed.",
			);
		} else if (nextState.roundPhase === "active") {
			emitCue(
				"roundLifecycle",
				"Round started",
				"Your clue is ready.",
			);
		}
	}

	if (previousState.roundPhase !== nextState.roundPhase) {
		if (nextState.roundPhase === "active" && previousState.roundPhase !== "active") {
			emitCue("roundLifecycle", "Clues revealed", "The round is now live.");
		}
		if (nextState.roundPhase === "timeout-guess") {
			emitCue(
				"roundLifecycle",
				"Main timer ended",
				"Spies can use remaining guesses before the reveal.",
			);
		}
		if (nextState.roundPhase === "revealed-spy-guess") {
			emitCue(
				"roundLifecycle",
				"Final spy guess phase",
				"Revealed spies can finish any remaining guesses before the round ends.",
			);
		}
	}

	if (
		nextState.roundPhase === "active" &&
		nextState.questionTurn?.suggestedAskerName === nextMe.name &&
		previousState.questionTurn?.suggestedAskerName !== nextMe.name &&
		!nextState.activeQuestion
	) {
		emitCue(
			"questionTurns",
			"Your turn to ask",
			nextState.questionTurn?.suggestedTargetName
				? `Suggested target: ${nextState.questionTurn.suggestedTargetName}`
				: "You can ask any eligible player.",
		);
	}

	if (nextState.activeQuestion?.id !== previousState.activeQuestion?.id) {
		if (nextState.activeQuestion) {
			if (nextState.activeQuestion.targetName === nextMe.name) {
				emitCue(
					"questionTurns",
					`${nextState.activeQuestion.askerName} asked you a question`,
					"Choose one of the two options.",
				);
			} else if (nextState.activeQuestion.askerName === nextMe.name) {
				emitCue(
					"questionTurns",
					"Question sent",
					`Waiting for ${nextState.activeQuestion.targetName} to answer.`,
				);
			}
		} else if (previousState.activeQuestion?.askerName === nextMe.name) {
			const latestQuestion = nextState.questionHistory?.[nextState.questionHistory.length - 1];
			if (latestQuestion) {
				emitCue(
					"questionTurns",
					latestQuestion.outcome === "timeout"
						? "Question expired"
						: "Question answered",
					latestQuestion.outcome === "timeout"
						? `${latestQuestion.targetName} did not answer in time.`
						: `${latestQuestion.targetName} chose: ${latestQuestion.recordedChoiceText}`,
				);
			}
		}
	}

	if (nextState.spyOffer && !previousState.spyOffer) {
		emitCue(
			"spyRoleEvents",
			"Spy offer",
			"You have been offered the spy role for this round.",
		);
	}

	if (previousMe.revealedSpyStatus !== nextMe.revealedSpyStatus && nextMe.revealedSpyStatus) {
		emitCue(
			"spyRoleEvents",
			nextMe.revealedSpyStatus === "spy"
				? "You were revealed as a spy"
				: "You were revealed as not-spy",
			getCueDetailForReveal(nextMe.revealedSpyStatus),
		);
	}

	const accusationChanged =
		Boolean(nextState.activeAccusationVote) &&
		(!previousState.activeAccusationVote ||
			previousState.activeAccusationVote.targetName !==
				nextState.activeAccusationVote.targetName ||
			previousState.activeAccusationVote.initiatedByName !==
				nextState.activeAccusationVote.initiatedByName);
	if (accusationChanged) {
		emitCue(
			"accusationsVotes",
			nextState.activeAccusationVote.eligibleToVote
				? "Vote requested"
				: "Accusation started",
			`${nextState.activeAccusationVote.initiatedByName} started a vote on ${nextState.activeAccusationVote.targetName}.`,
		);
	}

	if (
		previousState.activeAccusationVote &&
		!nextState.activeAccusationVote &&
		nextState.accusationLog?.length > previousState.accusationLog?.length
	) {
		const latestAccusationMessage =
			nextState.accusationLog[nextState.accusationLog.length - 1]?.message || "";
		if (latestAccusationMessage.startsWith("Vote on ")) {
			emitCue(
				"accusationsVotes",
				"Vote resolved",
				latestAccusationMessage,
			);
		}
	}

	if (nextState.accusationLog?.length > previousState.accusationLog?.length) {
		const newMessages = nextState.accusationLog.slice(previousState.accusationLog.length);
		for (const entry of newMessages) {
			if (!entry?.message) continue;
			if (entry.message.includes(`${nextMe.name} was revealed as a spy`)) {
				emitCue(
					"spyRoleEvents",
					"Spy reveal confirmed",
					entry.message,
				);
				break;
			}
			if (entry.message.includes(`${nextMe.name} was not a spy`)) {
				emitCue(
					"spyRoleEvents",
					"Accusation result",
					entry.message,
				);
				break;
			}
		}
	}

	if (previousMe.isObserver !== nextMe.isObserver) {
		emitCue(
			"adminRoomNotices",
			nextMe.isObserver ? "You are observing" : "You rejoined the round",
			nextMe.isObserver
				? "An admin changed your participation status for this round."
				: "You can participate again.",
		);
	}
};

const Game = ({ loading }) => {
	const router = useRouter();
	const t = useI18n();
	const locale = useCurrentLocale();
	const { gameCode } = router.query;

	const [gameState, setGameState] = useState({
		status: "loading",
	});
	const [isConnected, setIsConnected] = useState(socket.connected);
	const [savedDisplayName, setSavedDisplayNameState] = useState("");
	const [cuePreferences, setCuePreferences] = useState(() =>
		getSavedEventCuePreferences(),
	);
	const [cueToasts, setCueToasts] = useState([]);

	const cuePreferencesRef = useRef(cuePreferences);
	const previousGameStateRef = useRef(null);
	const audioContextRef = useRef(null);

	useEffect(() => {
		cuePreferencesRef.current = cuePreferences;
	}, [cuePreferences]);

	useEffect(() => {
		setGameState({ status: "loading" });
		previousGameStateRef.current = null;
	}, [gameCode]);

	useEffect(() => {
		if (!router.isReady) return;
		setSavedDisplayNameState(getSavedDisplayName());
	}, [router.isReady]);

	const emitCue = useCallback((groupId, title, detail = "") => {
		const preferences = cuePreferencesRef.current;
		if (!preferences.enabled || !preferences.groups[groupId]) return;

		const cueId = `cue-${Date.now()}-${Math.random().toString(16).slice(2)}`;
		setCueToasts((currentToasts) => [
			...currentToasts.slice(-3),
			{ id: cueId, title, detail },
		]);
		setTimeout(() => {
			setCueToasts((currentToasts) =>
				currentToasts.filter((toast) => toast.id !== cueId),
			);
		}, 4200);

		if (typeof window === "undefined") return;
		const AudioContextClass = window.AudioContext || window.webkitAudioContext;
		if (!AudioContextClass) return;
		try {
			if (!audioContextRef.current) {
				audioContextRef.current = new AudioContextClass();
			}
			playCuePattern(audioContextRef.current, groupId).catch(() => {});
		} catch (_error) {
			// Browser audio can stay locked until the user interacts.
		}
	}, []);

	const handleCuePreferenceChange = (nextPreferences) => {
		setCuePreferences(setSavedEventCuePreferences(nextPreferences));
	};

	const handlePlayTestCue = () => {
		emitCue(
			"adminRoomNotices",
			"Test cue",
			"Visual and sound cues are enabled on this device.",
		);
	};

	useEffect(() => {
		if (!router.isReady || !gameCode) return;

		const handleConnect = () => setIsConnected(true);
		const handleDisconnect = () => setIsConnected(false);
		const handleGameChange = (newGameState) => {
			const previousGameState = previousGameStateRef.current;
			if (previousGameState) {
				maybeEmitStateCues(previousGameState, newGameState, emitCue);
			}
			previousGameStateRef.current = newGameState;
			setGameState(newGameState);
		};
		const handleInvalid = () => router.push("/join?invalid=" + gameCode);
		const handleBadName = () => {
			emitCue(
				"adminRoomNotices",
				"Name unavailable",
				"Please choose an alternate display name.",
			);
			Swal.fire(
				"Name already in use",
				"Please choose an alternate display name.",
				"warning",
			);
		};
		const handleLockedWarning = (minutes) => {
			emitCue(
				"adminRoomNotices",
				"Server temporarily locked",
				`New rooms are unavailable ${minutes <= 0 ? "right now" : `for about ${minutes} minute${Number(minutes) === 1 ? "" : "s"}`}.`,
			);
			Swal.fire(lockedMessage(minutes)).then(() => router.push("/"));
		};
		const handleActionError = (message) => {
			emitCue("adminRoomNotices", "Room notice", message);
			Swal.fire(message);
		};
		const handleRoundOutcome = (payload) => {
			emitCue(
				"roundLifecycle",
				payload?.title || "Round complete",
				payload?.text || "",
			);
			Swal.fire(
				payload?.title || "Round complete",
				payload?.text || "",
				payload?.everyoneWins ? "success" : "info",
			);
		};

		socket.on("connect", handleConnect);
		socket.on("disconnect", handleDisconnect);
		socket.on("gameChange", handleGameChange);
		socket.on("invalid", handleInvalid);
		socket.on("badName", handleBadName);
		socket.on("lockedWarning", handleLockedWarning);
		socket.on("actionError", handleActionError);
		socket.on("roundOutcome", handleRoundOutcome);

		if (!socket.connected) {
			socket.connect();
		}

		return () => {
			socket.off("connect", handleConnect);
			socket.off("disconnect", handleDisconnect);
			socket.off("gameChange", handleGameChange);
			socket.off("invalid", handleInvalid);
			socket.off("badName", handleBadName);
			socket.off("lockedWarning", handleLockedWarning);
			socket.off("actionError", handleActionError);
			socket.off("roundOutcome", handleRoundOutcome);
			socket.disconnect();
		};
	}, [emitCue, gameCode, router, router.isReady]);

	useEffect(() => {
		if (!router.isReady || !gameCode || !isConnected) return;
		socket.emit("joinGame", {
			gameCode,
			authToken: getOrCreateAuthToken(),
			locale,
		});
	}, [gameCode, isConnected, router.isReady]);

	useEffect(() => {
		if (!router.isReady || !gameCode || !isConnected) return;
		socket.emit("setLocale", locale);
	}, [gameCode, isConnected, locale, router.isReady]);

	const onNameEntry = (name) => {
		socket.emit("name", name);
	};

	useEffect(() => {
		if (!gameState.me?.name) return;
		const nextSavedName = setSavedDisplayName(gameState.me.name);
		setSavedDisplayNameState(nextSavedName);
	}, [gameState.me?.name]);

	const { status, me = {} } = gameState;

	const showLoading = status === "loading" || loading;
	const showNameEntry = !showLoading && !me.name;
	const showLobby = !showNameEntry && status.startsWith("lobby");
	const showGame = !showNameEntry && status === "ingame";

	return (
		<>
			<EventCueToastStack toasts={cueToasts} />
			{!showLoading && !isConnected && (
				<div className="connection-banner" role="alert">
					Disconnected. <button className="btn-small" onClick={() => socket.connect()}>
						Reconnect
					</button>
				</div>
			)}

			{showLoading && (
				<>
					<h4>{t("ui.waiting for players")}</h4>
					<Loading />
					<div>{socket.connected ? "Connected" : "Disconnected"}</div>
					<button className="btn-small" onClick={() => socket.connect()}>
						Reconnect
					</button>
				</>
			)}
			{!showLoading && (
				<>
					{showNameEntry && (
						<NameEntry
							onNameEntry={onNameEntry}
							gameCode={gameState.code}
							socket={socket}
							initialName={savedDisplayName}
						/>
					)}
					{showLobby && <Lobby gameState={gameState} socket={socket} />}
					{showGame && <InGame gameState={gameState} socket={socket} />}
					{!showNameEntry && (
						<EventCueSettings
							cuePreferences={cuePreferences}
							onChange={handleCuePreferenceChange}
							onPlayTestCue={handlePlayTestCue}
						/>
					)}
				</>
			)}
		</>
	);
};

export default Game;
