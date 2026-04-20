const EVENT_CUE_STORAGE_KEY = "spyfall.eventCues";

export const EVENT_CUE_GROUPS = [
	{
		id: "questionTurns",
		label: "Question turns",
		description: "Suggested asker changes, incoming questions, and question results.",
	},
	{
		id: "accusationsVotes",
		label: "Accusations & votes",
		description: "Vote starts, vote requests, and accusation outcomes.",
	},
	{
		id: "spyRoleEvents",
		label: "Spy-role events",
		description: "Spy offers, reveals, and guess opportunities.",
	},
	{
		id: "roundLifecycle",
		label: "Round lifecycle",
		description: "Round start, clue reveal, guess phases, and round end.",
	},
	{
		id: "adminRoomNotices",
		label: "Admin & room notices",
		description: "Warnings, validation errors, and room-management notices.",
	},
];

export const DEFAULT_EVENT_CUE_PREFERENCES = {
	enabled: true,
	groups: EVENT_CUE_GROUPS.reduce((result, group) => {
		result[group.id] = true;
		return result;
	}, {}),
};

const sanitizePreferences = (value = {}) => ({
	enabled:
		typeof value?.enabled === "boolean"
			? value.enabled
			: DEFAULT_EVENT_CUE_PREFERENCES.enabled,
	groups: EVENT_CUE_GROUPS.reduce((result, group) => {
		result[group.id] =
			typeof value?.groups?.[group.id] === "boolean"
				? value.groups[group.id]
				: DEFAULT_EVENT_CUE_PREFERENCES.groups[group.id];
		return result;
	}, {}),
});

export const getSavedEventCuePreferences = () => {
	if (typeof window === "undefined") {
		return DEFAULT_EVENT_CUE_PREFERENCES;
	}

	try {
		const rawValue = window.localStorage.getItem(EVENT_CUE_STORAGE_KEY);
		if (!rawValue) return DEFAULT_EVENT_CUE_PREFERENCES;
		return sanitizePreferences(JSON.parse(rawValue));
	} catch (_error) {
		return DEFAULT_EVENT_CUE_PREFERENCES;
	}
};

export const setSavedEventCuePreferences = (value) => {
	const nextValue = sanitizePreferences(value);
	if (typeof window === "undefined") return nextValue;

	window.localStorage.setItem(
		EVENT_CUE_STORAGE_KEY,
		JSON.stringify(nextValue),
	);
	return nextValue;
};
