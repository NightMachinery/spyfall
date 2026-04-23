import React, { useState, useEffect, useMemo } from "react";
import Router from "next/router";
import Swal from "sweetalert2";

import StrikeableBox from "./StrikeableBox";
import { logEvent } from "../utils/analytics";
import AccessCode from "./AccessCode";
import HideableContainer from "./HideableContainer";
import { useCurrentLocale, useI18n } from "../locales";

const InGame = ({ gameState, socket }) => {
	const {
		me,
		word,
		wordList,
		players,
		timeLeft: latestServerTimeLeft,
		timePaused,
		settings,
		roundPhase,
		spyOffer,
		questionHistory,
		accusationLog,
		activeQuestion,
		questionTurn,
		activeAccusationVote,
		currentRoundNum,
	} = gameState;

	const [timeLeft, setTimeLeft] = useState(latestServerTimeLeft);
	const [spyGuessMode, setSpyGuessMode] = useState(false);
	const [selectedGuessWordId, setSelectedGuessWordId] = useState("");
	const [wordMarks, setWordMarks] = useState({});
	const t = useI18n();
	const lang = useCurrentLocale();
	const isSpy = me.role === "spy";
	const isObserver = Boolean(me.isObserver);
	const isRoundActive = roundPhase === "active";
	const isTimeoutGuessPhase = roundPhase === "timeout-guess";
	const isRevealedSpyGuessPhase = roundPhase === "revealed-spy-guess";
	const isGuessPhase = isTimeoutGuessPhase || isRevealedSpyGuessPhase;
	const isSpyOfferPhase = roundPhase === "offering-spies";
	const isPreRevealPhase = roundPhase === "zero-spy-delay";
	const isRoundToolsVisible = isRoundActive || isGuessPhase;
	const canManageRoom = Boolean(me.isAdmin);
	const canGuessNow =
		isSpy &&
		(isRoundActive || isGuessPhase) &&
		me.guessesRemaining > 0 &&
		(!isGuessPhase || !me.timeoutGuessDone);
	const wordListKey = wordList.map(({ id }) => id).join("\u0000");
	const selectedGuessWord =
		wordList.find(({ id }) => id === selectedGuessWordId)?.label || "";

	useEffect(() => {
		logEvent("player-roundCount", gameState.currentRoundNum + 1);
		logEvent("player-language", lang);
	}, []);

	useEffect(() => {
		let interval = null;
		if (!timePaused && timeLeft > 0 && isRoundToolsVisible) {
			interval = setInterval(() => {
				setTimeLeft((currentTimeLeft) => Math.max(0, currentTimeLeft - 1));
			}, 1000);
		}
		return () => clearInterval(interval);
	}, [isRoundToolsVisible, timePaused, timeLeft]);

	useEffect(() => setTimeLeft(latestServerTimeLeft), [latestServerTimeLeft]);

	useEffect(() => {
		setSpyGuessMode(false);
		setSelectedGuessWordId("");
		setWordMarks({});
	}, [currentRoundNum, wordListKey]);

	useEffect(() => {
		if (!wordList.some(({ id }) => id === selectedGuessWordId)) {
			setSelectedGuessWordId("");
		}
	}, [wordList, selectedGuessWordId]);

	useEffect(() => {
		if (!canGuessNow) {
			setSpyGuessMode(false);
			setSelectedGuessWordId("");
		}
	}, [canGuessNow]);

	const showTimer =
		isRoundToolsVisible &&
		settings.timeLimit !== 0 &&
		latestServerTimeLeft !== null;
	const timeExpired = timeLeft <= 0;
	const minutesLeft = Math.floor((timeLeft || 0) / 60);
	const secondsLeft = (((timeLeft || 0) % 60) + "").padStart(2, "0");
	const showTapToPause =
		canManageRoom && isRoundActive && !timePaused && timeLeft > 0;

	const handleKickPlayer = (playerName) =>
		popup("Kick player", t("ui.back"), () =>
			socket.emit("kickPlayer", playerName),
		);

	const handleTogglePause = () => {
		if (timeExpired || !canManageRoom || !isRoundActive) return;
		socket.emit("togglePause");
		logEvent("togglePause", true);
	};

	const handleToggleManualObserver = (playerName) => {
		socket.emit("togglePlayerObserver", playerName);
	};

	const handleCycleWordMark = (wordEntry) => {
		if (spyGuessMode) {
			setSelectedGuessWordId(wordEntry.id);
			return;
		}

		setWordMarks((current) => {
			const nextValue = ((current[wordEntry.id] || 0) + 1) % 3;
			if (nextValue === 0) {
				const next = { ...current };
				delete next[wordEntry.id];
				return next;
			}
			return {
				...current,
				[wordEntry.id]: nextValue,
			};
		});
	};

	const handleStartSpyGuess = () => {
		if (!canGuessNow) return;
		setSpyGuessMode(true);
		setSelectedGuessWordId("");
	};

	const handleCancelSpyGuess = () => {
		setSpyGuessMode(false);
		setSelectedGuessWordId("");
	};

	const handleConfirmSpyGuess = () => {
		if (!selectedGuessWordId) return;
		socket.emit("submitSpyGuess", selectedGuessWordId);
		setSpyGuessMode(false);
		setSelectedGuessWordId("");
	};

	return (
		<div name="gameView" style={{ userSelect: "none" }}>
			{showTimer && (
				<div
					style={{ marginBottom: "1em" }}
					onClick={canManageRoom && isRoundActive ? handleTogglePause : undefined}
				>
					<h4
						className={
							"game-countdown " +
							(timeExpired ? "finished " : " ") +
							(timePaused ? "paused" : "")
						}
						style={{ marginBottom: "0.25em" }}
					>
						{minutesLeft}:{secondsLeft}
					</h4>
					<div>
						{timePaused && <div className="red-text">Game paused</div>}
						{showTapToPause && <div className="subtitle">Tap to pause</div>}
						{isTimeoutGuessPhase && (
							<div className="subtitle">
								Main timer ended. Spies may use remaining guesses before reveal.
							</div>
						)}
						{isRevealedSpyGuessPhase && (
							<div className="subtitle">
								All spies have been revealed. Revealed spies may use any remaining
								guesses before the round ends.
							</div>
						)}
					</div>
				</div>
			)}

			<AccessCode code={gameState.code} />

			<HideableContainer title={"Your Status"} initialHidden={false}>
				<div className="status-container-content">
					<RolePanel
						me={me}
						word={word}
						isSpy={isSpy}
						isObserver={isObserver}
						isSpyOfferPhase={isSpyOfferPhase}
						isPreRevealPhase={isPreRevealPhase}
						isTimeoutGuessPhase={isTimeoutGuessPhase}
						isRevealedSpyGuessPhase={isRevealedSpyGuessPhase}
						spyOffer={spyOffer}
						socket={socket}
						t={t}
						spyGuessMode={spyGuessMode}
						selectedGuessWord={selectedGuessWord}
						onStartSpyGuess={handleStartSpyGuess}
						onCancelSpyGuess={handleCancelSpyGuess}
						onConfirmSpyGuess={handleConfirmSpyGuess}
					/>
				</div>
			</HideableContainer>

			{isGuessPhase && (
				<div className="question-active-card" style={{ marginBottom: "1em" }}>
					<div>
						{isTimeoutGuessPhase
							? "Questions and accusations are closed while spies finish any remaining guesses."
							: "All hidden spies have been found. Questions and accusations are closed while revealed spies finish any remaining guesses."}
					</div>
					{canManageRoom && (
						<div style={{ marginTop: "0.75em" }}>
							<button
								className="btn-small"
								onClick={() => socket.emit("endTimeoutGuessPhase")}
							>
								End guess phase now
							</button>
						</div>
					)}
				</div>
			)}

			{isRoundActive && (
				<div style={{ marginBottom: "0.75em" }}>
					{questionTurn?.suggestedAskerName ? (
						<div>
							Suggested asker: <strong>{questionTurn.suggestedAskerName}</strong>
							{questionTurn?.suggestedTargetName && (
								<>
									{" "}
									(default target: <strong>{questionTurn.suggestedTargetName}</strong>)
								</>
							)}
						</div>
					) : (
						<div>No eligible question asker right now.</div>
					)}
				</div>
			)}

			{isRoundActive ? (
				<QuestionHelper
					activeQuestion={activeQuestion}
					players={players}
					me={me}
					socket={socket}
					questionTurn={questionTurn}
					activeAccusationVote={activeAccusationVote}
					currentRoundNum={currentRoundNum}
				/>
			) : !isGuessPhase ? (
				<HideableContainer title={"Round Tools"} initialHidden={false}>
					<div className="status-container-content question-helper">
						<div className="settings-help">
							{isSpyOfferPhase || isPreRevealPhase
								? "Questioning, accusations, and guesses unlock once clues are revealed."
								: "Questioning, accusations, and guesses unlock once the round becomes active."}
						</div>
					</div>
				</HideableContainer>
			) : null}

			{isRoundToolsVisible && (
				<>
					<QuestionStatus
						activeQuestion={activeQuestion}
						questionHistory={questionHistory}
						me={me}
						socket={socket}
					/>
					<AccusationPanel
						players={players}
						me={me}
						socket={socket}
						activeAccusationVote={activeAccusationVote}
						accusationLog={accusationLog}
						isRoundActive={isRoundActive}
					/>
				</>
			)}

			<h5>{t("ui.players")}</h5>
			<ul className="ingame-player-list">
				{players.map((player, i) => (
					<StrikeableBox key={i}>
						<div>
							{player.name && player.name}
							{player.isCreator && <strong> (creator)</strong>}
							{player.isAdmin && !player.isCreator && (
								<strong> (acting admin)</strong>
							)}
							{player.manualObserver && <strong> (manual observer)</strong>}
							{player.isObserver && !player.manualObserver && (
								<strong> (observer)</strong>
							)}
							{player.revealedSpyStatus && (
								<strong>
									{" "}
									(revealed: {formatRevealedSpyStatus(player.revealedSpyStatus)})
								</strong>
							)}
						</div>
						{!player.name && <i>Joining...</i>}
						{player.isFirst && (
							<div
								className="first-player-indicator"
								dangerouslySetInnerHTML={{ __html: t("ui.first") }}
							></div>
						)}
						{!player.connected && <i> (Disconnected)</i>}
						<div className="settings-help">
							Accusations left: {player.accusationsRemaining}
							{player.canVote && " · can vote"}
						</div>
						{isRoundActive &&
							canManageRoom &&
							player.name &&
							player.connected &&
							player.name !== me.name &&
							!player.isObserver && (
								<div>
									<button
										className="btn-small"
										onClick={() => handleKickPlayer(player.name)}
									>
										Kick from round
									</button>
								</div>
							)}
						{canManageRoom && player.name && player.name !== me.name && (
							<div>
								<button
									className="btn-small"
									onClick={() => handleToggleManualObserver(player.name)}
								>
									{player.manualObserver ? "Set as player" : "Set as observer"}
								</button>
							</div>
						)}
						{isRoundActive &&
							canManageRoom &&
							player.isObserver &&
							player.connected &&
							player.name &&
							!player.manualObserver && (
								<div>
									{player.canBePromoted ? (
										<button
											className="btn-small"
											onClick={() => socket.emit("promoteObserver", player.name)}
										>
											Promote into round
										</button>
									) : (
										<div className="settings-help">Cannot rejoin this round.</div>
									)}
								</div>
							)}
					</StrikeableBox>
				))}
			</ul>

			<div className="u-cf"></div>

			{isRoundToolsVisible && wordList.length > 0 && (
				<>
					<h5>Word Reference</h5>
					<WordReferenceList
						wordList={wordList}
						spyGuessMode={spyGuessMode}
						selectedGuessWordId={selectedGuessWordId}
						wordMarks={wordMarks}
						onWordClick={handleCycleWordMark}
					/>
				</>
			)}

			<div className="button-container">
				{canManageRoom && (
					<button
						className="btn-end"
						onClick={() =>
							popup("End Round", t("ui.back"), () => socket.emit("endGame"))
						}
					>
						{t("ui.end game")}
					</button>
				)}
				<button
					className="btn-leave"
					onClick={() =>
						popup(t("ui.leave game"), t("ui.back"), () => {
							socket.disconnect();
							Router.push("/");
						})
					}
				>
					{t("ui.leave game")}
				</button>
			</div>
		</div>
	);
};

const RolePanel = ({
	me,
	word,
	isSpy,
	isObserver,
	isSpyOfferPhase,
	isPreRevealPhase,
	isTimeoutGuessPhase,
	isRevealedSpyGuessPhase,
	spyOffer,
	socket,
	t,
	spyGuessMode,
	selectedGuessWord,
	onStartSpyGuess,
	onCancelSpyGuess,
	onConfirmSpyGuess,
}) => {
	if (isObserver) {
		return (
			<div
				className={
					me.revealedSpyStatus === "spy"
						? "player-status player-status-spy"
						: "player-status player-status-not-spy"
				}
			>
				{getObserverStatusMessage(me)}
			</div>
		);
	}

	if (isSpyOfferPhase) {
		return <SpyOfferStatus spyOffer={spyOffer} isSpy={isSpy} socket={socket} />;
	}

	if (isPreRevealPhase) {
		return (
			<div className="player-status player-status-not-spy">
				Waiting for clues to be revealed.
			</div>
		);
	}

	if (isSpy) {
		const isGuessPhase = isTimeoutGuessPhase || isRevealedSpyGuessPhase;
		const showGuessControls = me.guessesRemaining > 0 && !me.timeoutGuessDone;
		return (
			<>
				<div className="player-status player-status-spy">
					{me.revealedSpyStatus === "spy"
						? "You are a revealed spy."
						: t("ui.you are the spy")}
				</div>
				<div className="settings-help">Guesses left: {me.guessesRemaining}</div>
				<div className="settings-help">
					{isRevealedSpyGuessPhase
						? "All spies have been found. Use any remaining guesses, or mark yourself done."
						: isTimeoutGuessPhase
							? "The timer ended. Use any remaining guesses, or mark yourself done."
							: me.revealedSpyStatus === "spy"
								? "You were revealed, but you may still use your remaining guesses at any time."
								: "Tap words below to cycle neutral, yellow, and pink. Use guess mode only when you want to submit a real guess."}
				</div>
				{me.timeoutGuessDone && isGuessPhase && (
					<div className="settings-help">You marked yourself done guessing.</div>
				)}
				{!showGuessControls && isGuessPhase && (
					<div className="settings-help">No guesses left. Waiting for reveal.</div>
				)}
				{showGuessControls && (
					<div style={{ marginTop: "0.75em" }}>
						{!spyGuessMode ? (
							<button className="btn-small" onClick={onStartSpyGuess}>
								Guess a word
							</button>
						) : (
							<>
								<div className="settings-help">
									Guess mode is active. Tap a word below to select it, then
									confirm or cancel.
								</div>
								<div className="settings-help">
									Selected guess: {selectedGuessWord || "none"}
								</div>
								<button
									className="btn-small"
									disabled={!selectedGuessWord}
									onClick={onConfirmSpyGuess}
								>
									Guess selected word
								</button>
								<button className="btn-small" onClick={onCancelSpyGuess}>
									Cancel
								</button>
							</>
						)}
						{isGuessPhase && (
							<button
								className="btn-small"
								onClick={() => socket.emit("completeTimeoutGuessing")}
							>
								Done guessing
							</button>
						)}
					</div>
				)}
			</>
		);
	}

	return (
		<>
			<div
				className="player-status player-status-not-spy"
				dangerouslySetInnerHTML={{ __html: t("ui.you are not the spy") }}
			></div>
			{word && (
				<div className="current-location">
					<div className="current-location-header">Chosen word:</div>
					<div className="current-location-name">
						{word.label}
					</div>
				</div>
			)}
		</>
	);
};

const SpyOfferStatus = ({ spyOffer, isSpy, socket }) => {
	if (spyOffer) {
		return (
			<div className="player-status player-status-spy">
				<div>You have been offered the spy role for this round.</div>
				<div style={{ marginTop: "0.75em" }}>
					<button
						className="btn-small"
						style={{ marginRight: "0.5em" }}
						onClick={() => socket.emit("acceptSpyOffer")}
					>
						Accept
					</button>
					{spyOffer.canRefuse && (
						<button
							className="btn-small"
							onClick={() => socket.emit("refuseSpyOffer")}
						>
							Refuse
						</button>
					)}
				</div>
			</div>
		);
	}

	if (isSpy) {
		return (
			<div className="player-status player-status-spy">
				You are the spy. Waiting for the remaining spies to be finalized.
			</div>
		);
	}

	return (
		<div className="player-status player-status-not-spy">
			Waiting for spy offers to finish before your clue is revealed.
		</div>
	);
};

const QuestionHelper = ({
	activeQuestion,
	players,
	me,
	socket,
	questionTurn,
	activeAccusationVote,
	currentRoundNum,
}) => {
	const [targetName, setTargetName] = useState("");
	const [optionOne, setOptionOne] = useState("");
	const [optionTwo, setOptionTwo] = useState("");

	const canAsk = Boolean(
		me.name && !me.isObserver && me.revealedSpyStatus !== "spy",
	);
	const isSuggestedAsker = questionTurn?.suggestedAskerName === me.name;
	const connectedTargets = players.filter(
		(player) =>
			player.name &&
			player.connected &&
			!player.isObserver &&
			player.revealedSpyStatus !== "spy" &&
			player.name !== me.name,
	);

	useEffect(() => {
		if (!activeQuestion && isSuggestedAsker) {
			setTargetName(questionTurn?.suggestedTargetName || "");
		}
	}, [activeQuestion, isSuggestedAsker, questionTurn?.suggestedTargetName]);

	const submitPrompt = () => {
		socket.emit("submitQuestionPrompt", {
			targetName,
			optionOne,
			optionTwo,
		});
		setOptionOne("");
		setOptionTwo("");
	};

	return (
		<HideableContainer
			key={`question-${currentRoundNum}-${questionTurn?.suggestedAskerName}-${me.name}-${activeQuestion?.id || "idle"}`}
			title={"Question Helper"}
			initialHidden={!isSuggestedAsker}
		>
			<div className="status-container-content question-helper">
				{!activeQuestion && !activeAccusationVote && canAsk ? (
					<>
						<div className="settings-help">
							Ask two choices and let the target pick one. Anyone can ask
							manually, but the suggested asker is highlighted above.
						</div>
						<label htmlFor="question-target">Ask this player:</label>
						<select
							id="question-target"
							className="u-full-width"
							value={targetName}
							onChange={({ target: { value } }) => setTargetName(value)}
						>
							<option value="">Choose a player</option>
							{connectedTargets.map((player) => (
								<option key={player.name} value={player.name}>
									{player.name}
								</option>
							))}
						</select>
						<input
							type="text"
							placeholder="Question option 1"
							className="u-full-width"
							value={optionOne}
							onChange={({ target: { value } }) => setOptionOne(value)}
							maxLength={160}
						/>
						<input
							type="text"
							placeholder="Question option 2"
							className="u-full-width"
							value={optionTwo}
							onChange={({ target: { value } }) => setOptionTwo(value)}
							maxLength={160}
						/>
						<button
							className="btn-small"
							disabled={!targetName || !optionOne.trim() || !optionTwo.trim()}
							onClick={submitPrompt}
						>
							Send options
						</button>
					</>
				) : (
					<div className="settings-help">
						{activeQuestion || activeAccusationVote
							? "Finish the current interaction before asking a new question."
							: "You cannot ask a question right now."}
					</div>
				)}
			</div>
		</HideableContainer>
	);
};

const QuestionStatus = ({ activeQuestion, questionHistory, me, socket }) => {
	const [questionTimeLeft, setQuestionTimeLeft] = useState(null);
	const canAnswer = activeQuestion?.targetName === me.name;

	useEffect(() => {
		if (!activeQuestion) {
			setQuestionTimeLeft(null);
			return;
		}
		const update = () => {
			if (!activeQuestion.expiresAt) {
				setQuestionTimeLeft(null);
				return;
			}
			setQuestionTimeLeft(
				Math.max(0, Math.ceil((activeQuestion.expiresAt - Date.now()) / 1000)),
			);
		};
		update();
		const interval = setInterval(update, 500);
		return () => clearInterval(interval);
	}, [activeQuestion]);

	return (
		<div style={{ marginBottom: "1em" }}>
			<h5>Current Question</h5>
			{activeQuestion ? (
				<div className="question-active-card">
					<div>
						<strong>{activeQuestion.askerName}</strong> is asking <strong>{activeQuestion.targetName}</strong>.
					</div>
					{questionTimeLeft !== null && (
						<div className="settings-help">Response timer: {questionTimeLeft}s</div>
					)}
					<ol>
						{activeQuestion.options.map((option, index) => (
							<li key={`${option}-${index}`}>
								{option}{" "}
								{canAnswer && (
									<button
										className="btn-small"
										onClick={() => socket.emit("chooseQuestionOption", index)}
									>
										Choose
									</button>
								)}
							</li>
						))}
					</ol>
				</div>
			) : (
				<div className="settings-help">No active question right now.</div>
			)}

			<div style={{ marginTop: "1em" }}>
				<h5>Question History</h5>
				{questionHistory.length === 0 && (
					<div className="settings-help">No questions logged yet.</div>
				)}
				{questionHistory.length > 0 && (
					<ol className="question-history-list">
						{questionHistory.map((entry, index) => (
							<li key={`${entry.askerName}-${entry.targetName}-${index}`}>
								<div>
									<strong>
										{entry.askerName} → {entry.targetName}
									</strong>
								</div>
								<div>Options: 1) {entry.options[0]} 2) {entry.options[1]}</div>
								<div>
									Result:{" "}
									{entry.outcome === "timeout"
										? "unanswered in time"
										: entry.recordedChoiceText}
								</div>
							</li>
						))}
					</ol>
				)}
			</div>
		</div>
	);
};

const AccusationPanel = ({
	players,
	me,
	socket,
	activeAccusationVote,
	accusationLog,
	isRoundActive,
}) => {
	const [starterTargetName, setStarterTargetName] = useState("");

	const accusationTargets = useMemo(
		() =>
			players.filter(
				(player) =>
					player.name &&
					player.connected &&
					!player.isObserver &&
					!player.revealedSpyStatus &&
					player.name !== me.name,
			),
		[players, me.name],
	);

	useEffect(() => {
		if (!starterTargetName && accusationTargets[0]) {
			setStarterTargetName(accusationTargets[0].name);
		}
	}, [accusationTargets, starterTargetName]);

	const canInitiate = Boolean(
		isRoundActive &&
			me.name &&
			!me.isObserver &&
			me.revealedSpyStatus !== "spy" &&
			me.accusationsRemaining > 0,
	);

	return (
		<HideableContainer title={"Accusations"} initialHidden={false}>
			<div className="status-container-content question-helper">
				<div className="settings-help">
					Each player can start one accusation total per round. Voting does not
					spend your accusation.
				</div>

				{activeAccusationVote && (
					<div className="question-active-card">
						<div>
							<strong>{activeAccusationVote.initiatedByName}</strong> started a
							vote on <strong>{activeAccusationVote.targetName}</strong>.
						</div>
						<div className="settings-help">
							Yes: {activeAccusationVote.yesVotes} · No: {activeAccusationVote.noVotes} · Pending: {activeAccusationVote.pendingVotes}
						</div>
						{activeAccusationVote.eligibleToVote &&
							activeAccusationVote.myVote === null && (
								<div>
									<button
										className="btn-small"
										onClick={() => socket.emit("voteAccusation", true)}
									>
										Vote yes
									</button>
									<button
										className="btn-small"
										onClick={() => socket.emit("voteAccusation", false)}
									>
										Vote no
									</button>
								</div>
							)}
						{activeAccusationVote.eligibleToVote &&
							activeAccusationVote.myVote !== null && (
								<div className="settings-help">
									You voted {activeAccusationVote.myVote ? "yes" : "no"}.
								</div>
							)}
					</div>
				)}

				{!activeAccusationVote && canInitiate && (
					<div style={{ marginBottom: "1em" }}>
						<div className="settings-help">
							Start a player accusation or call a terminal accusation.
						</div>
						<select
							className="u-full-width"
							value={starterTargetName}
							onChange={({ target: { value } }) => setStarterTargetName(value)}
						>
							<option value="">Choose a player</option>
							{accusationTargets.map((player) => (
								<option key={player.name} value={player.name}>
									{player.name}
								</option>
							))}
						</select>
						<button
							className="btn-small"
							disabled={!starterTargetName}
							onClick={() => socket.emit("startPlayerAccusation", starterTargetName)}
						>
							Start accusation
						</button>
						<button
							className="btn-small"
							onClick={() => socket.emit("startTerminalAccusation", "no-spy")}
						>
							No Spy
						</button>
						<button
							className="btn-small"
							onClick={() =>
								socket.emit("startTerminalAccusation", "everyone-remaining-spy")
							}
						>
							Everyone Remaining is a Spy
						</button>
					</div>
				)}

				{!activeAccusationVote && !canInitiate && isRoundActive && (
					<div className="settings-help">
						{me.accusationsRemaining > 0
							? "You cannot start an accusation right now."
							: "You have already used your accusation this round."}
					</div>
				)}

				<div style={{ marginTop: "1em" }}>
					<h5>Accusation Log</h5>
					{(!accusationLog || accusationLog.length === 0) && (
						<div className="settings-help">No accusation events yet.</div>
					)}
					{accusationLog?.length > 0 && (
						<ol className="question-history-list">
							{accusationLog.map((entry) => (
								<li key={entry.id}>{entry.message}</li>
							))}
						</ol>
					)}
				</div>
			</div>
		</HideableContainer>
	);
};

const WordReferenceList = ({
	wordList,
	spyGuessMode,
	selectedGuessWordId,
	wordMarks,
	onWordClick,
}) => (
	<ul className="location-list">
		{wordList.map((word) => {
			const isSelected = selectedGuessWordId === word.id;
			const markState = wordMarks[word.id] || 0;
			return (
				<li key={word.id} onClick={() => onWordClick(word)}>
					<div
						className={getWordMarkClassName(markState)}
						style={
							spyGuessMode && isSelected
								? { outline: "2px solid #cc0000", fontWeight: 700 }
								: undefined
						}
					>
						{word.label}
						{spyGuessMode && isSelected && " (selected guess)"}
					</div>
				</li>
			);
		})}
	</ul>
);

const getWordMarkClassName = (markState) => {
	if (markState === 1) return "box box-mark-yellow";
	if (markState === 2) return "box box-mark-pink";
	return "box";
};

const formatRevealedSpyStatus = (status) => {
	if (status === "spy") return "spy";
	if (status === "not-spy") return "not spy";
	return "";
};

const getObserverStatusMessage = (player) => {
	if (player.manualObserver) {
		return "You are observing by admin choice. An admin can set you back to player mode.";
	}
	if (player.revealedSpyStatus === "spy") {
		return "You were removed from the round and revealed as the spy. You cannot rejoin this round, but you may still use any remaining guesses until the round ends.";
	}
	if (player.observerReason === "accusation-not-spy") {
		return "You were voted out of the round as not-spy. You can still vote on accusations.";
	}
	if (player.revealedSpyStatus === "not-spy") {
		return "You were removed from the round and revealed as not the spy. An admin can promote you back into the round.";
	}
	return "You are observing this round. An admin can promote you into the round as a non-spy player.";
};

const popup = (yesText, noText, onYes) =>
	Swal.fire({
		title: "Are you sure?",
		icon: "warning",
		showCancelButton: true,
		confirmButtonText: yesText,
		cancelButtonText: noText,
	}).then((result) => {
		if (result.value) {
			onYes();
		}
	});

export default InGame;
