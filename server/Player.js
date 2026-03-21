class Player {
	constructor(socket, authToken) {
		this.socket = socket;
		this.authToken = authToken;
		this.name = "";
		this.connected = true;
		this.disconnectTimeout = null;
		this.observer = false;
		this.reset();
	}

	reset = () => {
		this.role = null;
		this.isFirst = false;
	};

	clearDisconnectTimeout = () => {
		if (!this.disconnectTimeout) return;
		clearTimeout(this.disconnectTimeout);
		this.disconnectTimeout = null;
	};

	getPublicInfo = (isCreator = false, isAdmin = false) => ({
		name: this.name,
		isFirst: this.isFirst,
		connected: this.connected,
		isCreator,
		isAdmin,
		isObserver: this.observer,
	});

	getPrivateInfo = (isCreator = false, isAdmin = false) => ({
		...this.getPublicInfo(isCreator, isAdmin),
		role: this.role,
	});
}

module.exports = Player;
