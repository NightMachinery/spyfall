import React, { useState, useEffect } from "react";
import { useRouter } from "next/router";
import socketIOClient from "socket.io-client";
import Swal from "sweetalert2";
import { useI18n } from "../locales";

import NameEntry from "../components/NameEntry";
import Lobby from "../components/Lobby";
import InGame from "../components/InGame";
import Loading from "../components/Loading";
import { lockedMessage } from "../utils/misc";
import { getOrCreateAuthToken } from "../utils/localIdentity";

const socket = socketIOClient({
	autoConnect: false,
});

const Game = ({ loading }) => {
	const router = useRouter();
	const t = useI18n();
	const { gameCode } = router.query;

	const [gameState, setGameState] = useState({
		status: "loading",
	});
	const [isRocketcrab, setIsRocketcrab] = useState(false);
	const [isConnected, setIsConnected] = useState(socket.connected);

	useEffect(() => {
		if (!router.isReady) return;

		const urlParams = new URLSearchParams(window.location.search);
		setIsRocketcrab(urlParams.get("rocketcrab") === "true");
	}, [router.isReady]);

	useEffect(() => {
		setGameState({ status: "loading" });
	}, [gameCode]);

	useEffect(() => {
		if (!router.isReady || !gameCode) return;

		const handleConnect = () => setIsConnected(true);
		const handleDisconnect = () => setIsConnected(false);
		const handleGameChange = (newGameState) => setGameState(newGameState);
		const handleInvalid = () => router.push("/join?invalid=" + gameCode);
		const handleBadName = () => Swal.fire("Name already in use");
		const handleLockedWarning = (minutes) =>
			Swal.fire(lockedMessage(minutes)).then(() => router.push("/"));
		const handleActionError = (message) => Swal.fire(message);

		socket.on("connect", handleConnect);
		socket.on("disconnect", handleDisconnect);
		socket.on("gameChange", handleGameChange);
		socket.on("invalid", handleInvalid);
		socket.on("badName", handleBadName);
		socket.on("lockedWarning", handleLockedWarning);
		socket.on("actionError", handleActionError);

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
			socket.disconnect();
		};
	}, [gameCode, router, router.isReady]);

	useEffect(() => {
		if (!router.isReady || !gameCode || !isConnected) return;
		socket.emit("joinGame", {
			gameCode,
			authToken: getOrCreateAuthToken(),
		});
	}, [gameCode, isConnected, router.isReady]);

	useEffect(() => {
		if (!router.isReady || !gameCode) return;

		const urlParams = new URLSearchParams(window.location.search);
		const rocketcrabName = urlParams.get("name");
		const rocketcrabEnabled = urlParams.get("rocketcrab") === "true";
		if (rocketcrabEnabled && rocketcrabName && gameState.me && !gameState.me.name) {
			onNameEntry(rocketcrabName);
		}
	}, [gameCode, gameState.me, router.isReady]);

	const onNameEntry = (name) => {
		socket.emit("name", name);
	};

	const { status, me = {} } = gameState;

	const showLoading = status === "loading" || loading;
	const showNameEntry = !showLoading && !me.name;
	const showLobby = !showNameEntry && status.startsWith("lobby");
	const showGame = !showNameEntry && status === "ingame";

	return (
		<>
			{!showLoading && !isConnected && (
				<div className="connection-banner" role="alert">
					Disconnected.{" "}
					<button className="btn-small" onClick={() => socket.connect()}>
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
						/>
					)}
					{showLobby && (
						<Lobby
							gameState={gameState}
							socket={socket}
							isRocketcrab={isRocketcrab}
						/>
					)}
					{showGame && (
						<InGame
							gameState={gameState}
							socket={socket}
							isRocketcrab={isRocketcrab}
						/>
					)}
				</>
			)}
		</>
	);
};

export default Game;
