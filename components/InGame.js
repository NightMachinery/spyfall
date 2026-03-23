import React, { useState, useEffect, useMemo } from "react";
import Router from "next/router";
import Swal from "sweetalert2";

import StrikeableBox from "./StrikeableBox";
import { logEvent } from "../utils/analytics";
import AccessCode from "./AccessCode";
import HideableContainer from "./HideableContainer";
import { useCurrentLocale, useI18n } from "../locales";

const InGame = ({ gameState, socket, isRocketcrab }) => {
	const {
		me,
		location,
		locationList,
		players,
		timeLeft: latestServerTimeLeft,
		timePaused,
		settings,
		roundPhase,
		spyOffer,
		roundMode,
		questionHistory,
		activeQuestion,
		questionTurn,
		accusationPhase,
		activeAccusationVote,
	} = gameState;

	const [timeLeft, setTimeLeft] = useState(latestServerTimeLeft);
	const t = useI18n();
	const lang = useCurrentLocale();
	const isSpy = me.role === "spy";
	const isObserver = Boolean(me.isObserver);
	const isCustomRound = roundMode === "custom";
	const isRoundActive = roundPhase === "active";
	const isSpyOfferPhase = roundPhase === "offering-spies";
	const canManageRoom = Boolean(me.isAdmin);

	useEffect(() => {
		logEvent("player-roundCount", gameState.currentRoundNum + 1);
		logEvent("player-language", lang);
	}, []);

	useEffect(() => {
		let interval = null;
		if (!timePaused && timeLeft > 0) {
			interval = setInterval(() => {
				setTimeLeft((currentTimeLeft) => Math.max(0, currentTimeLeft - 1));
			}, 1000);
		}
		return () => clearInterval(interval);
	}, [timePaused, timeLeft]);

	useEffect(() => setTimeLeft(latestServerTimeLeft), [latestServerTimeLeft]);

	const showTimer =
		isRoundActive && settings.timeLimit !== 0 && latestServerTimeLeft !== null;
	const timeExpired = timeLeft <= 0;
	const minutesLeft = Math.floor((timeLeft || 0) / 60);
	const secondsLeft = (((timeLeft || 0) % 60) + "").padStart(2, "0");
	const showTapToPause = canManageRoom && !timePaused && timeLeft > 0;

	const handleKickPlayer = (playerName) =>
		popup("Kick player", t("ui.back"), () =>
			socket.emit("kickPlayer", playerName),
		);

	const handleTogglePause = () => {
		if (timeExpired || !canManageRoom) return;
		socket.emit("togglePause");
		logEvent("togglePause", true);
	};

	const handleToggleManualObserver = (playerName) => {
		socket.emit("togglePlayerObserver", playerName);
	};

	return (
		<div name="gameView" style={{ userSelect: "none" }}>
			{showTimer && (
				<div
					style={{ marginBottom: "1em" }}
					onClick={canManageRoom ? handleTogglePause : undefined}
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
					</div>
				</div>
			)}

			{!isRocketcrab && <AccessCode code={gameState.code} />}

			<HideableContainer title={"Your Role"} initialHidden={false}>
				<div className="status-container-content">
					<RolePanel
						me={me}
						location={location}
						locationList={locationList}
						isCustomRound={isCustomRound}
						isSpy={isSpy}
						isObserver={isObserver}
						isSpyOfferPhase={isSpyOfferPhase}
						spyOffer={spyOffer}
						socket={socket}
						t={t}
					/>
				</div>
			</HideableContainer>

			<div style={{ marginBottom: "0.75em" }}>
				{questionTurn?.suggestedAskerName ? (
					<div>
						Suggested asker: <strong>{questionTurn.suggestedAskerName}</strong>
						{questionTurn?.suggestedTargetName && (
							<>
								{" "}
								(default target:{" "}
								<strong>{questionTurn.suggestedTargetName}</strong>)
							</>
						)}
					</div>
				) : (
					<div>No eligible question asker right now.</div>
				)}
			</div>

			{isRoundActive ? (
				<>
					<QuestionHelper
						activeQuestion={activeQuestion}
						questionHistory={questionHistory}
						players={players}
						me={me}
						socket={socket}
						questionTurn={questionTurn}
						activeAccusationVote={activeAccusationVote}
						accusationPhase={accusationPhase}
					/>
					<AccusationPanel
						players={players}
						me={me}
						socket={socket}
						accusationPhase={accusationPhase}
						activeAccusationVote={activeAccusationVote}
					/>
				</>
			) : (
				<HideableContainer title={"Round Tools"} initialHidden={false}>
					<div className="status-container-content question-helper">
						<div className="settings-help">
							Questioning, accusations, and guesses unlock once the round
							becomes active.
						</div>
					</div>
				</HideableContainer>
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
									(revealed: {formatRevealedSpyStatus(player.revealedSpyStatus)}
									)
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
											onClick={() =>
												socket.emit("promoteObserver", player.name)
											}
										>
											Promote into round
										</button>
									) : (
										<div className="settings-help">
											Cannot rejoin this round.
										</div>
									)}
								</div>
							)}
					</StrikeableBox>
				))}
			</ul>

			<div className="u-cf"></div>

			{isRoundActive && locationList.length > 0 && (
				<>
					<h5>
						{isCustomRound ? "Word Reference" : t("ui.location reference")}
					</h5>
					<ul className="location-list">
						{locationList.map((name, i) => (
							<StrikeableBox key={i}>
								{renderRoundLabel(name, isCustomRound, t)}
							</StrikeableBox>
						))}
					</ul>
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
				{!isRocketcrab && (
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
				)}
			</div>
		</div>
	);
};

const RolePanel = ({
	me,
	location,
	locationList,
	isCustomRound,
	isSpy,
	isObserver,
	isSpyOfferPhase,
	spyOffer,
	socket,
	t,
}) => {
	const [guess, setGuess] = useState("");

	useEffect(() => {
		if (!locationList.includes(guess)) {
			setGuess(locationList[0] || "");
		}
	}, [locationList, guess]);

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

	if (isSpy) {
		return (
			<>
				<div className="player-status player-status-spy">
					{me.revealedSpyStatus === "spy"
						? "You are a revealed spy."
						: t("ui.you are the spy")}
				</div>
				<div className="settings-help">Guesses left: {me.guessesRemaining}</div>
				{me.guessesRemaining > 0 && locationList.length > 0 && (
					<div style={{ marginTop: "0.75em" }}>
						<label htmlFor="spy-guess-select">Declare a guess:</label>
						<select
							id="spy-guess-select"
							className="u-full-width"
							value={guess}
							onChange={({ target: { value } }) => setGuess(value)}
						>
							<option value="">Choose a guess</option>
							{locationList.map((entry) => (
								<option key={entry} value={entry}>
									{entry}
								</option>
							))}
						</select>
						<button
							className="btn-small"
							disabled={!guess}
							onClick={() => socket.emit("submitSpyGuess", guess)}
						>
							Submit guess
						</button>
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
			{location && (
				<div className="current-location">
					<div className="current-location-header">
						{isCustomRound ? "Chosen word:" : `${t("ui.the location")}:`}
					</div>
					<div className="current-location-name">
						{renderRoundLabel(location.name, isCustomRound, t)}
					</div>
				</div>
			)}
			{!isCustomRound && me.role && (
				<div className="current-role">
					<div className="current-role-header">{t("ui.your role")}: </div>
					<div className="current-role-name">{t(me.role)}</div>
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
	questionHistory,
	players,
	me,
	socket,
	questionTurn,
	activeAccusationVote,
	accusationPhase,
}) => {
	const [targetName, setTargetName] = useState("");
	const [optionOne, setOptionOne] = useState("");
	const [optionTwo, setOptionTwo] = useState("");
	const [questionTimeLeft, setQuestionTimeLeft] = useState(null);

	const canAsk = Boolean(
		me.name && !me.isObserver && me.revealedSpyStatus !== "spy",
	);
	const isSuggestedAsker = questionTurn?.suggestedAskerName === me.name;
	const canAnswer = activeQuestion?.targetName === me.name;
	const connectedTargets = players.filter(
		(player) =>
			player.name &&
			player.connected &&
			!player.isObserver &&
			player.revealedSpyStatus !== "spy" &&
			player.name !== me.name,
	);

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
			key={`question-${questionTurn?.suggestedAskerName}-${me.name}-${activeQuestion?.id || "idle"}`}
			title={"Question Helper"}
			initialHidden={!isSuggestedAsker}
		>
			<div className="status-container-content question-helper">
				{!activeQuestion &&
					!activeAccusationVote &&
					!accusationPhase &&
					canAsk && (
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
					)}

				{activeQuestion && (
					<div className="question-active-card">
						<div>
							<strong>{activeQuestion.askerName}</strong> is asking{" "}
							<strong>{activeQuestion.targetName}</strong>.
						</div>
						{questionTimeLeft !== null && (
							<div className="settings-help">
								Response timer: {questionTimeLeft}s
							</div>
						)}
						<ol>
							{activeQuestion.options.map((option, index) => (
								<li key={option}>
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
									<div>
										Options: 1) {entry.options[0]} 2) {entry.options[1]}
									</div>
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
		</HideableContainer>
	);
};

const AccusationPanel = ({
	players,
	me,
	socket,
	accusationPhase,
	activeAccusationVote,
}) => {
	const [targetName, setTargetName] = useState("");
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
		if (!targetName && accusationTargets[0]) {
			setTargetName(accusationTargets[0].name);
		}
	}, [accusationTargets, starterTargetName, targetName]);

	const canInitiate = Boolean(
		me.name && !me.isObserver && me.revealedSpyStatus !== "spy",
	);
	const myTurn = accusationPhase?.currentTurnName === me.name;
	const myTurnIsCounter = accusationPhase?.currentTurnKind === "counter";

	return (
		<HideableContainer title={"Accusations"} initialHidden={false}>
			<div className="status-container-content question-helper">
				<div className="settings-help">
					Your remaining accusations are public. Revealed non-spies can still
					vote; revealed spies cannot.
				</div>

				{activeAccusationVote && (
					<div className="question-active-card">
						<div>
							<strong>{activeAccusationVote.initiatedByName}</strong> started a
							vote on <strong>{activeAccusationVote.targetName}</strong>
							{activeAccusationVote.isCounter && " (counter-accusation)"}.
						</div>
						<div className="settings-help">
							Yes: {activeAccusationVote.yesVotes} · No:{" "}
							{activeAccusationVote.noVotes} · Pending:{" "}
							{activeAccusationVote.pendingVotes}
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

				{!activeAccusationVote && accusationPhase?.currentTurnName && (
					<div className="question-active-card">
						<div>
							Current accusation turn:{" "}
							<strong>{accusationPhase.currentTurnName}</strong>
							{accusationPhase.currentTurnKind === "counter" &&
								" (counter-accusation)"}
						</div>
						{myTurn ? (
							<>
								<select
									className="u-full-width"
									value={targetName}
									onChange={({ target: { value } }) => setTargetName(value)}
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
									disabled={!targetName}
									onClick={() =>
										socket.emit("submitPlayerAccusation", targetName)
									}
								>
									{myTurnIsCounter ? "Counter-accuse" : "Accuse"}
								</button>
								<button
									className="btn-small"
									onClick={() => socket.emit("passAccusationTurn")}
								>
									Pass
								</button>
							</>
						) : (
							<div className="settings-help">
								Waiting for {accusationPhase.currentTurnName} to accuse or pass.
							</div>
						)}
					</div>
				)}

				{!activeAccusationVote &&
					!accusationPhase?.currentTurnName &&
					canInitiate && (
						<div style={{ marginBottom: "1em" }}>
							<div className="settings-help">
								Start a voted accusation or call a terminal accusation.
							</div>
							<select
								className="u-full-width"
								value={starterTargetName}
								onChange={({ target: { value } }) =>
									setStarterTargetName(value)
								}
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
								onClick={() =>
									socket.emit("startPlayerAccusation", starterTargetName)
								}
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
									socket.emit(
										"startTerminalAccusation",
										"everyone-remaining-spy",
									)
								}
							>
								Everyone Remaining is a Spy
							</button>
						</div>
					)}

				{accusationPhase?.scoreEntries?.length > 0 && (
					<div>
						<h5>Accusation Scoreboard</h5>
						<ul>
							{accusationPhase.scoreEntries.map((entry) => (
								<li key={entry.targetAuthToken}>
									{entry.targetName}: {entry.yesVotes} yes votes
								</li>
							))}
						</ul>
					</div>
				)}
			</div>
		</HideableContainer>
	);
};

const renderRoundLabel = (value, isCustomRound, t) =>
	isCustomRound ? value : t(value);

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
		return "You were removed from the round and revealed as the spy. You cannot rejoin this round.";
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
