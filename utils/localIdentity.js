const AUTH_TOKEN_STORAGE_KEY = "spyfall.authToken";
const DISPLAY_NAME_STORAGE_KEY = "spyfall.displayName";

const sanitizeDisplayName = (value) =>
	String(value || "")
		.trim()
		.replace(/\s+/g, " ")
		.slice(0, 24);

const createAuthToken = () => {
	if (typeof window !== "undefined" && window.crypto?.randomUUID) {
		return window.crypto.randomUUID();
	}

	if (typeof window !== "undefined" && window.crypto?.getRandomValues) {
		const bytes = new Uint8Array(16);
		window.crypto.getRandomValues(bytes);
		return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
			""
		);
	}

	return `spyfall-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export const getOrCreateAuthToken = () => {
	if (typeof window === "undefined") return "";

	const existingToken = window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
	if (existingToken) return existingToken;

	const nextToken = createAuthToken();
	window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, nextToken);
	return nextToken;
};

export const getSavedDisplayName = () => {
	if (typeof window === "undefined") return "";

	return window.localStorage.getItem(DISPLAY_NAME_STORAGE_KEY) || "";
};

export const setSavedDisplayName = (value) => {
	if (typeof window === "undefined") return "";

	const nextName = sanitizeDisplayName(value);

	if (nextName) {
		window.localStorage.setItem(DISPLAY_NAME_STORAGE_KEY, nextName);
	} else {
		window.localStorage.removeItem(DISPLAY_NAME_STORAGE_KEY);
	}

	return nextName;
};
