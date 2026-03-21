const AUTH_TOKEN_STORAGE_KEY = "spyfall.authToken";

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
