import React, { useState, useEffect } from "react";
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
	} = gameState;

	const [timeLeft, setTimeLeft] = useState(latestServerTimeLeft);
	const t = useI18n();
	const lang = useCurrentLocale();
	const isSpy = me.role === "spy";
	const isObserver = Boolean(me.isObserver);
	const isCustomRound = roundMode === "custom";
	const isRoundActive = roundPhase === "active";
	const isSpyOfferPhase = roundPhase === "offering-spies";
	const firstPlayer = players.find((player) => player.isFirst);
	const canManageRoom = Boolean(me.isAdmin);

	useEffect(() => {
		logEvent("player-roundCount", gameState.currentRoundNum + 1);
		logEvent("player-language", lang);
	}, []);

	useEffect(() => {
		let interval = null;
		if (!timePaused && timeLeft > 0) {
			interval = setInterval(() => {
				if (timeLeft <= 0) {
					clearInterval(interval);
					setTimeLeft(0);
					if (gameState.players[0].name === me.name) {
						logEvent("timerExpired", true);
					}
					return;
				}
				setTimeLeft((currentTimeLeft) => currentTimeLeft - 1);
			}, 1000);
		} else if (timePaused && timeLeft !== 0) {
			clearInterval(interval);
		}
		return () => clearInterval(interval);
	}, [timePaused, timeLeft]);

	useEffect(() => setTimeLeft(latestServerTimeLeft), [latestServerTimeLeft]);

	const showTimer =
		isRoundActive && settings.timeLimit !== 0 && latestServerTimeLeft !== null;
	const timeExpired = timeLeft <= 0;
	const minutesLeft = Math.floor(timeLeft / 60);
	const secondsLeft = ((timeLeft % 60) + "").padStart(2, "0");
	const showTapToPause = canManageRoom && !timePaused && timeLeft > 0;

	const handleTogglePause = () => {
		if (timeExpired || !canManageRoom) return;

		socket.emit("togglePause");
		logEvent("togglePause", true);
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
					{isObserver && (
						<div className="player-status player-status-not-spy">
							You are observing this round. An admin can promote you into the
							round as a non-spy player.
						</div>
					)}
					{!isObserver && !isSpyOfferPhase && isSpy && (
						<div className="player-status player-status-spy">
							{t("ui.you are the spy")}
						</div>
					)}
					{!isObserver && isSpyOfferPhase && (
						<SpyOfferStatus spyOffer={spyOffer} isSpy={isSpy} socket={socket} />
					)}
					{!isObserver && !isSpyOfferPhase && !isSpy && (
						<>
							<div
								className="player-status player-status-not-spy"
								dangerouslySetInnerHTML={{
									__html: t("ui.you are not the spy"),
								}}
							></div>

							{location && (
								<div className="current-location">
									<div className="current-location-header">
										{isCustomRound ? "Chosen word" : `${t("ui.the location")}:`}
									</div>
									<div className="current-location-name">
										{renderRoundLabel(location.name, isCustomRound, t)}
									</div>
								</div>
							)}

							{!isCustomRound && me.role && (
								<div className="current-role">
									<div className="current-role-header">
										{t("ui.your role")}:{" "}
									</div>
									<div className="current-role-name">{t(me.role)}</div>
								</div>
							)}
						</>
					)}
				</div>
			</HideableContainer>

			{me.isFirst && (
				<div className="red-text">You will ask the first question.</div>
			)}
			{!me.isFirst && firstPlayer && (
				<div>The first question will be asked by {firstPlayer.name}.</div>
			)}

			{isRoundActive ? (
				<QuestionHelper
					activeQuestion={activeQuestion}
					questionHistory={questionHistory}
					players={players}
					me={me}
					socket={socket}
				/>
			) : (
				<HideableContainer title={"Question Helper"} initialHidden={false}>
					<div className="status-container-content question-helper">
						<div className="settings-help">
							Question logging unlocks after all spies have been finalized and
							clues are revealed.
						</div>
					</div>
				</HideableContainer>
			)}

			<h5>{t("ui.players")}</h5>
			<ul className="ingame-player-list">
				{players.map((player, i) => (
					<StrikeableBox key={i}>
						{player.name && player.name}
						{player.isCreator && <strong> (creator)</strong>}
						{player.isAdmin && !player.isCreator && (
							<strong> (acting admin)</strong>
						)}
						{player.isObserver && <strong> (observer)</strong>}
						{!player.name && <i>Joining...</i>}
						{player.isFirst && (
							<div
								className="first-player-indicator"
								dangerouslySetInnerHTML={{ __html: t("ui.first") }}
							></div>
						)}
						{!player.connected && <i> (Disconnected)</i>}
						{isRoundActive &&
							canManageRoom &&
							player.isObserver &&
							player.connected &&
							player.name && (
								<div>
									<button
										className="btn-small"
										onClick={() => socket.emit("promoteObserver", player.name)}
									>
										Promote into round
									</button>
								</div>
							)}
					</StrikeableBox>
				))}
			</ul>

			<div className="u-cf"></div>

			{isRoundActive && locationList.length > 0 && (
				<>
					<h5>{isCustomRound ? "Word Reference" : t("ui.location reference")}</h5>
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
}) => {
	const [targetName, setTargetName] = useState("");
	const [optionOne, setOptionOne] = useState("");
	const [optionTwo, setOptionTwo] = useState("");
	const [answer, setAnswer] = useState("");

	useEffect(() => {
		if (!activeQuestion) {
			setAnswer("");
		}
	}, [activeQuestion]);

	const connectedTargets = players.filter(
		(player) =>
			player.name &&
			player.connected &&
			!player.isObserver &&
			player.name !== me.name,
	);
	const isObserver = Boolean(me.isObserver);
	const canAnswer = !isObserver && activeQuestion?.targetName === me.name;

	const submitPrompt = () => {
		socket.emit("submitQuestionPrompt", {
			targetName,
			optionOne,
			optionTwo,
		});
		setOptionOne("");
		setOptionTwo("");
	};

	const submitAnswer = () => {
		socket.emit("submitQuestionAnswer", answer);
		setAnswer("");
	};

	return (
		<HideableContainer title={"Question Helper"} initialHidden={false}>
			<div className="status-container-content question-helper">
				{isObserver && (
					<div className="settings-help">
						Observers cannot ask or answer questions until they are promoted
						into the round.
					</div>
				)}
				{!activeQuestion && !isObserver && (
					<>
						<div className="settings-help">
							Enter 2 possible questions, choose who they are directed to, and
							log the final question/answer pair for everyone.
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
						<ol>
							{activeQuestion.options.map((option, index) => (
								<li key={option}>
									{option}{" "}
									{activeQuestion.selectedOptionIndex === index && (
										<strong>(chosen)</strong>
									)}
									{canAnswer && activeQuestion.selectedOptionIndex === null && (
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
						{canAnswer && activeQuestion.selectedOptionIndex !== null && (
							<>
								<input
									type="text"
									className="u-full-width"
									placeholder="Type the answer"
									value={answer}
									maxLength={300}
									onChange={({ target: { value } }) => setAnswer(value)}
								/>
								<button
									className="btn-small"
									disabled={!answer.trim()}
									onClick={submitAnswer}
								>
									Log answer
								</button>
							</>
						)}
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
									<div>Q: {entry.question}</div>
									<div>A: {entry.answer}</div>
								</li>
							))}
						</ol>
					)}
				</div>
			</div>
		</HideableContainer>
	);
};

const renderRoundLabel = (value, isCustomRound, t) =>
	isCustomRound ? value : t(value);

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
