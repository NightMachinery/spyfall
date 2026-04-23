import Router from "next/router";
import { useI18n } from "../locales";

import { logEvent } from "../utils/analytics";

import Settings from "./Settings";
import AccessCode from "./AccessCode";
import HideableContainer from "./HideableContainer";

const Lobby = ({ gameState, socket }) => {
	const { me } = gameState;
	const playerList = gameState.players.map((player) => ({
		...player,
		isMe: player.name === me.name,
	}));
	const canManageRoom = Boolean(me.isAdmin);
	const creatorPresent = gameState.players.some(
		(player) => player.isCreator && player.connected,
	);

	const handleStartGame = () => {
		socket.emit("startGame");
		logEvent("lobby-numberOfPlayers", gameState.players.length);
		logEvent("lobby-wordpack", gameState.settings.wordpack);
		logEvent("lobby-timeLimit", gameState.settings.timeLimit);
	};

	const t = useI18n();

	return (
		<>
			<h4>{t("ui.welcome to spyfall")}</h4>

			<AccessCode code={gameState.code} />

			<hr />

			{me.isCreator && (
				<div className="room-creator-note">You are the room creator.</div>
			)}
			{!me.isCreator && canManageRoom && (
				<div className="room-creator-note">
					You are the acting admin while the creator is away.
				</div>
			)}
			{!canManageRoom && (
				<div className="room-creator-note">
					{creatorPresent
						? "Only the room creator can manage this room."
						: "Only the current admin can manage this room."}
				</div>
			)}

			<ol className="lobby-player-list">
				{playerList.map((player, i) => (
					<li key={i} className="player-box">
						<span>
							{player.name}
							{player.isCreator && <strong> (creator)</strong>}
							{player.isAdmin && !player.isCreator && (
								<strong> (acting admin)</strong>
							)}
							{player.manualObserver && <strong> (observer)</strong>}
						</span>
						{!player.name && <i>Joining...</i>}
						{player.name && !player.connected && <i> (Disconnected)</i>}

						{player.isMe && (
							<a
								href="#"
								className="btn-edit-player"
								onClick={(event) => {
									event.preventDefault();
									socket.emit("clearName");
								}}
							>
								Edit name
							</a>
						)}
						{!player.isMe && canManageRoom && !player.isCreator && (
							<>
								<a
									href="#"
									className="btn-remove-player"
									onClick={(event) => {
										event.preventDefault();
										socket.emit("removePlayer", player.name);
									}}
								>
									Remove player
								</a>
								<a
									href="#"
									className="btn-edit-player"
									onClick={(event) => {
										event.preventDefault();
										socket.emit("togglePlayerObserver", player.name);
									}}
								>
									{player.manualObserver ? "Set as player" : "Set as observer"}
								</a>
							</>
						)}
					</li>
				))}
			</ol>
			<br />
			<HideableContainer title={"Game Settings"} initialHidden={true}>
				<Settings gameState={gameState} socket={socket} />
			</HideableContainer>

			<div className="button-container">
				<button
					className="btn-start"
					onClick={handleStartGame}
					disabled={!canManageRoom || gameState.status !== "lobby-ready"}
				>
					{t("ui.start game")}
				</button>
				<button
					className="btn-leave"
					onClick={() => {
						socket.disconnect();
						Router.push("/");
					}}
				>
					{t("ui.leave game")}
				</button>
			</div>
		</>
	);
};

export default Lobby;
