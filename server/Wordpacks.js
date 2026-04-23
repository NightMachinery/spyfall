const fs = require("fs");
const path = require("path");

const WORDPACKS_PATH = path.resolve(__dirname, "../wordpacks");

const Wordpacks = loadWordpacks();

function loadWordpacks() {
	if (!fs.existsSync(WORDPACKS_PATH)) {
		return [];
	}

	return fs
		.readdirSync(WORDPACKS_PATH, { withFileTypes: true })
		.map((entry) => loadWordpackEntry(entry))
		.filter(Boolean)
		.sort((left, right) => left.name.localeCompare(right.name));
}

function loadWordpackEntry(entry) {
	const fullPath = path.join(WORDPACKS_PATH, entry.name);
	if (entry.isDirectory()) {
		return loadDirectoryWordpack(fullPath, entry.name);
	}
	if (entry.isFile() && entry.name.endsWith(".txt")) {
		return loadSingleFileWordpack(fullPath, path.basename(entry.name, ".txt"));
	}
	return null;
}

function loadSingleFileWordpack(filePath, id) {
	const labels = readWordLines(filePath);
	if (labels.length === 0) {
		console.warn(`Skipping empty wordpack file: ${filePath}`); // eslint-disable-line no-console
		return null;
	}
	return createWordpack({ id, kind: "single", labels });
}

function loadDirectoryWordpack(dirPath, id) {
	const localeEntries = fs
		.readdirSync(dirPath, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(".txt"));
	const localeFileMap = new Map(
		localeEntries.map((entry) => [path.basename(entry.name, ".txt"), entry.name]),
	);

	if (!localeFileMap.has("en")) {
		console.warn(`Skipping wordpack without en.txt fallback: ${dirPath}`); // eslint-disable-line no-console
		return null;
	}

	const englishLines = readWordLines(path.join(dirPath, localeFileMap.get("en")));
	if (englishLines.length === 0) {
		console.warn(`Skipping wordpack with empty en.txt: ${dirPath}`); // eslint-disable-line no-console
		return null;
	}

	const wordpack = createWordpack({ id, kind: "directory", labels: englishLines });
	wordpack.languages = ["en"];

	for (const [locale, filename] of localeFileMap.entries()) {
		if (locale === "en") continue;
		const labels = readWordLines(path.join(dirPath, filename));
		if (labels.length !== englishLines.length) {
			console.warn( // eslint-disable-line no-console
				`Ignoring misaligned locale file for ${id}: ${filename} (${labels.length} lines, expected ${englishLines.length})`,
			);
			continue;
		}
		labels.forEach((label, index) => {
			wordpack.words[index].labels[locale] = label;
		});
		wordpack.languages.push(locale);
	}

	wordpack.languages.sort((left, right) => left.localeCompare(right));
	return wordpack;
}

function createWordpack({ id, kind, labels }) {
	const words = labels.map((label, index) => ({
		id: String(index),
		defaultLabel: label,
		labels: { en: label },
	}));
	return {
		id,
		name: humanizeWordpackId(id),
		kind,
		words,
		wordById: new Map(words.map((word) => [word.id, word])),
		languages: kind === "single" ? [] : ["en"],
	};
}

function readWordLines(filePath) {
	return fs
		.readFileSync(filePath, "utf8")
		.replace(/\r/g, "")
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
}

function humanizeWordpackId(id) {
	return String(id)
		.replace(/[_-]+/g, " ")
		.replace(/([a-z])([A-Z])/g, "$1 $2")
		.replace(/([A-Za-z])(\d)/g, "$1 $2")
		.replace(/(\d)([A-Za-z])/g, "$1 $2")
		.trim();
}

function getWordpack(wordpackId) {
	return Wordpacks.find(({ id }) => id === wordpackId) || null;
}

function getRandomWordFromPack(wordpackId) {
	const wordpack = getWordpack(wordpackId);
	if (!wordpack?.words?.length) return null;
	return wordpack.words[Math.floor(Math.random() * wordpack.words.length)] || null;
}

function getWordListFromPack(wordpackId) {
	return getWordpack(wordpackId)?.words || [];
}

function localizeWord(wordpackId, word, locale) {
	if (!word) return null;

	const normalizedWord = normalizeWordLike(word);
	const wordpack = getWordpack(wordpackId);
	if (!wordpack) {
		return normalizedWord;
	}

	const packWord = wordpack.wordById.get(normalizedWord.id);
	if (!packWord) {
		return normalizedWord;
	}

	return {
		id: packWord.id,
		label: resolveWordLabel(packWord, locale),
	};
}

function localizeWordList(wordpackId, words, locale) {
	return (words || []).map((word) => localizeWord(wordpackId, word, locale)).filter(Boolean);
}

function normalizeWordLike(word) {
	if (typeof word === "string") {
		return {
			id: word,
			label: word,
		};
	}

	const label =
		typeof word.label === "string"
			? word.label
			: typeof word.defaultLabel === "string"
				? word.defaultLabel
				: typeof word.name === "string"
					? word.name
					: String(word.id || "");

	return {
		id: String(word.id || label),
		label,
	};
}

function resolveWordLabel(word, locale) {
	const chain = getLocaleFallbackChain(locale);
	for (const localeCode of chain) {
		if (word.labels[localeCode]) {
			return word.labels[localeCode];
		}
	}
	return word.defaultLabel;
}

function getLocaleFallbackChain(locale) {
	const normalized = String(locale || "en").trim() || "en";
	const chain = [];
	if (normalized) {
		chain.push(normalized);
	}
	if (normalized.includes("-")) {
		chain.push(normalized.split("-")[0]);
	}
	if (!chain.includes("en")) {
		chain.push("en");
	}
	return [...new Set(chain)];
}

const AVAILABLE_WORDPACKS = Wordpacks.map(({ id, name }) => ({
	id,
	name,
}));

module.exports = {
	AVAILABLE_WORDPACKS,
	getWordpack,
	getRandomWordFromPack,
	getWordListFromPack,
	localizeWord,
	localizeWordList,
};
