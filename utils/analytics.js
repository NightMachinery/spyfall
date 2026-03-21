import ReactGA from "react-ga4";

const measurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
let initialized = false;

export const initGA = () => {
	if (!measurementId || initialized || typeof window === "undefined") return;
	ReactGA.initialize(measurementId);
	initialized = true;
};

export const logPageView = () => {
	if (!measurementId || !initialized || typeof window === "undefined") return;
	ReactGA.set({ page: window.location.pathname });
	ReactGA.send({
		hitType: "pageview",
	});
};

export const logEvent = (category = "", action = "") => {
	if (!measurementId || !initialized) return;
	if (category && action) {
		ReactGA.event({ category, action: String(action) });
	}
};

export const logException = (description = "", fatal = false) => {
	if (!measurementId || !initialized) return;
	if (description) {
		// https://github.com/codler/react-ga4/issues/40
		// ReactGA.exception({ description, fatal });
	}
};
