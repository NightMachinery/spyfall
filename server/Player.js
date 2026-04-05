class Player {
	constructor(socket, authToken) {
		this.socket = socket;
		this.authToken = authToken;
		this.name = "";
		this.connected = true;
		this.disconnectTimeout = null;
		this.manualObserver = false;
		this.resetRoundState();
	}

	resetRoundState = () => {
		this.role = null;
		this.isFirst = false;
		this.observer = false;
		this.observerReason = null;
		this.revealedSpyStatus = null;
		this.canBePromoted = true;
		this.guessesRemaining = 0;
		this.accusationsRemaining = 0;
		this.timeoutGuessDone = false;
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
		isObserver: this.manualObserver || this.observer,
		manualObserver: this.manualObserver,
		observerReason: this.manualObserver ? "manual" : this.observerReason,
		revealedSpyStatus: this.revealedSpyStatus,
		canBePromoted: this.canBePromoted,
		accusationsRemaining: this.accusationsRemaining,
	});

	getPrivateInfo = (isCreator = false, isAdmin = false) => ({
		...this.getPublicInfo(isCreator, isAdmin),
		role: this.role,
		guessesRemaining: this.guessesRemaining,
		timeoutGuessDone: this.timeoutGuessDone,
	});
}

module.exports = Player;
