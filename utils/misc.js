const REPO_ACTIONS_URL = "https://github.com/NightMachinery/spyfall/actions";

export const lockedMessage = (minutes) => ({
	icon: "error",
	title: "Server temporarily locked",
	text:
		"This Spyfall server is preparing for an update and new rooms are unavailable " +
		getTimeLeft(minutes) +
		".",
	footer:
		"If you want to check deployment status, see " +
		`<a href="${REPO_ACTIONS_URL}" target="_blank" rel="noopener noreferrer">the repo actions page</a>.`,
});

const getTimeLeft = (minutes) => {
	if (minutes <= 0) return "right now";
	return "for about " + minutes + " minute" + (parseInt(minutes) !== 1 ? "s" : "");
};
