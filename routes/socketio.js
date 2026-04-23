module.exports = function (server) {
	const io = server.io;
	const spyfall = server.spyfall;

	io.on("connection", (socket) => {
		socket.on("joinGame", ({ gameCode, authToken, locale }) => {
			const theGame = spyfall.findGame(gameCode);
			if (theGame) {
				theGame.initPlayer(socket, authToken, locale);
			} else {
				socket.emit("invalid", { gameCode });
			}
		});
	});
};
