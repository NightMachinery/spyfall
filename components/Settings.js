import React, { useMemo, useState, useEffect } from "react";

const Settings = ({ gameState, socket }) => {
	const { settings, AVAILABLE_LOCATION_PACKS, players, me } = gameState;
	const canEdit = Boolean(me.isAdmin);
	const namedPlayerCount = players.filter(
		(player) => player.name && !player.manualObserver,
	).length;
	const maxSpyCount = Math.max(0, Math.max(namedPlayerCount, 2) - 1);

	const [customWordsText, setCustomWordsText] = useState(
		settings.customWordsText || "",
	);

	useEffect(() => {
		setCustomWordsText(settings.customWordsText || "");
	}, [settings.customWordsText]);

	const updateSettings = (partial) => socket.emit("updateSettings", partial);

	const customWordCount = useMemo(
		() =>
			customWordsText
				.split("\n")
				.map((word) => word.trim())
				.filter(Boolean).length,
		[customWordsText],
	);

	return (
		<div style={{ paddingTop: "1em" }}>
			{!canEdit && (
				<div className="settings-note">
					Only the current admin can edit settings.
				</div>
			)}

			<TimeLimit
				onSetMinutes={(minutes) => updateSettings({ timeLimit: minutes })}
				serverMinutes={settings.timeLimit}
				disabled={!canEdit}
			/>
			<br />

			<LocationPack
				onSetLocationPack={(packId) => updateSettings({ locationPack: packId })}
				serverPackId={settings.locationPack}
				locationPackList={AVAILABLE_LOCATION_PACKS}
				disabled={!canEdit}
			/>

			<SpySettings
				settings={settings}
				maxSpyCount={maxSpyCount}
				disabled={!canEdit}
				onUpdateSettings={updateSettings}
			/>

			<QuestionSettings
				settings={settings}
				disabled={!canEdit}
				onUpdateSettings={updateSettings}
			/>

			<AccusationSettings
				settings={settings}
				disabled={!canEdit}
				onUpdateSettings={updateSettings}
			/>

			<CustomWordSettings
				settings={settings}
				customWordsText={customWordsText}
				customWordCount={customWordCount}
				disabled={!canEdit}
				onTextChange={setCustomWordsText}
				onUpdateSettings={updateSettings}
			/>
		</div>
	);
};

const TimeLimit = ({ onSetMinutes, serverMinutes, disabled }) => {
	const minLength = 0;
	const maxLength = 60;
	const [minutes, setMinutes] = useState(serverMinutes);
	const handleChange = (change) => () => {
		const newMinutes = minutes + change;
		if (newMinutes >= minLength && newMinutes <= maxLength) {
			setMinutes(newMinutes);
			onSetMinutes(newMinutes);
		}
	};

	useEffect(() => {
		setMinutes(serverMinutes);
	}, [serverMinutes]);

	return (
		<div>
			<label>Time Limit:</label>
			<div style={{ margin: "-.5em 0 -1em" }}>
				<button
					className="btn-small"
					onClick={handleChange(-1)}
					disabled={disabled || minutes <= minLength}
				>
					-
				</button>
				<span>
					{minutes} minute{minutes !== 1 ? "s" : ""}
				</span>

				<button
					className="btn-small"
					onClick={handleChange(1)}
					disabled={disabled || minutes >= maxLength}
				>
					+
				</button>
			</div>
		</div>
	);
};

const LocationPack = ({
	onSetLocationPack,
	locationPackList,
	serverPackId,
	disabled,
}) => {
	const [selectedPackId, setSelectedPackId] = useState(serverPackId);

	const handleChange = (newPackId) => {
		setSelectedPackId(newPackId);
		onSetLocationPack(newPackId);
	};

	useEffect(() => {
		setSelectedPackId(serverPackId);
	}, [serverPackId]);

	return (
		<div>
			<label htmlFor="location-pack">Location Pack:</label>
			<select
				className="u-full-width"
				id="location-pack"
				value={selectedPackId}
				onChange={({ target: { value } }) => handleChange(value)}
				style={{ maxWidth: "10em" }}
				disabled={disabled}
			>
				{locationPackList.map(({ id, name }) => (
					<option key={id} value={id}>
						{name}
					</option>
				))}
			</select>
		</div>
	);
};

const SpySettings = ({ settings, maxSpyCount, disabled, onUpdateSettings }) => (
	<div style={{ marginTop: "1em" }}>
		<label>Spy Distribution:</label>
		<div className="settings-inline">
			<div>
				<span>Min</span>
				<input
					type="number"
					min="0"
					max={maxSpyCount}
					value={settings.spyCountMin}
					disabled={disabled}
					onChange={({ target: { value } }) =>
						onUpdateSettings({ spyCountMin: Number(value) })
					}
				/>
			</div>
			<div>
				<span>Max</span>
				<input
					type="number"
					min="0"
					max={maxSpyCount}
					value={settings.spyCountMax}
					disabled={disabled}
					onChange={({ target: { value } }) =>
						onUpdateSettings({ spyCountMax: Number(value) })
					}
				/>
			</div>
			<div>
				<span>Distribution</span>
				<select
					value={settings.spyCountDistribution}
					disabled={disabled}
					onChange={({ target: { value } }) =>
						onUpdateSettings({ spyCountDistribution: value })
					}
				>
					<option value="uniform">Uniform</option>
					<option value="geometric">Geometric</option>
				</select>
			</div>
		</div>
		<div className="settings-help">
			Geometric favors the lower end of the selected range.
		</div>

		<label>
			<input
				type="checkbox"
				checked={settings.includeAllSpy}
				disabled={disabled}
				onChange={({ target: { checked } }) =>
					onUpdateSettings({ includeAllSpy: checked })
				}
			/>
			<span className="label-body">
				Allow the rare all-spies round override
			</span>
		</label>

		<label>
			<input
				type="checkbox"
				checked={settings.allowSpyRefusal}
				disabled={disabled}
				onChange={({ target: { checked } }) =>
					onUpdateSettings({ allowSpyRefusal: checked })
				}
			/>
			<span className="label-body">
				Let players refuse being offered the spy role
			</span>
		</label>

		<label>
			<input
				type="checkbox"
				checked={settings.autoEndWhenAllSpiesRevealed}
				disabled={disabled}
				onChange={({ target: { checked } }) =>
					onUpdateSettings({ autoEndWhenAllSpiesRevealed: checked })
				}
			/>
			<span className="label-body">Auto-end when all spies are revealed</span>
		</label>

		<div className="settings-inline" style={{ marginTop: "0.5em" }}>
			<div>
				<span>Answer flip %</span>
				<input
					type="number"
					min="0"
					max="100"
					value={settings.answerFlipChancePercent}
					disabled={disabled}
					onChange={({ target: { value } }) =>
						onUpdateSettings({ answerFlipChancePercent: Number(value) })
					}
				/>
			</div>
			<div>
				<span>Spy guesses</span>
				<input
					type="number"
					min="0"
					max="20"
					value={settings.spyGuessLimit}
					disabled={disabled}
					onChange={({ target: { value } }) =>
						onUpdateSettings({ spyGuessLimit: Number(value) })
					}
				/>
			</div>
		</div>
	</div>
);

const QuestionSettings = ({ settings, disabled, onUpdateSettings }) => (
	<div style={{ marginTop: "1em" }}>
		<label>Question Flow:</label>
		<div className="settings-inline">
			<div>
				<span>Response timer (seconds)</span>
				<input
					type="number"
					min="0"
					max="300"
					value={settings.questionResponseSeconds}
					disabled={disabled}
					onChange={({ target: { value } }) =>
						onUpdateSettings({ questionResponseSeconds: Number(value) })
					}
				/>
			</div>
		</div>
		<div className="settings-help">
			0 disables the per-question response timer.
		</div>
	</div>
);

const AccusationSettings = ({ settings, disabled, onUpdateSettings }) => (
	<div style={{ marginTop: "1em" }}>
		<label>Accusations:</label>
		<div className="settings-help">
			Each player gets exactly one accusation per round. This includes terminal
			accusations.
		</div>
	</div>
);

const CustomWordSettings = ({
	settings,
	customWordsText,
	customWordCount,
	disabled,
	onTextChange,
	onUpdateSettings,
}) => (
	<div style={{ marginTop: "1em" }}>
		<label>
			<input
				type="checkbox"
				checked={settings.customWordsEnabled}
				disabled={disabled}
				onChange={({ target: { checked } }) =>
					onUpdateSettings({ customWordsEnabled: checked })
				}
			/>
			<span className="label-body">Use a custom word list</span>
		</label>

		{settings.customWordsEnabled && (
			<div style={{ marginTop: "0.5em" }}>
				{disabled && (
					<div className="settings-help" style={{ marginBottom: "0.5em" }}>
						The current admin configured a custom word list for this room.
					</div>
				)}
				<label htmlFor="custom-words-text">Custom words (one per line):</label>
				<textarea
					id="custom-words-text"
					className="u-full-width"
					rows="8"
					placeholder={"apple\nbanana\nmuseum\nsubmarine"}
					value={customWordsText}
					disabled={disabled}
					onChange={({ target: { value } }) => {
						onTextChange(value);
						onUpdateSettings({ customWordsText: value });
					}}
				/>
				{!disabled && (
					<div className="settings-help">
						{customWordCount} words entered. A fresh subset is sampled each
						round.
					</div>
				)}
				<label htmlFor="custom-subset-size">Subset size:</label>
				<input
					id="custom-subset-size"
					type="number"
					min="2"
					max={Math.max(2, customWordCount || settings.customSubsetSize)}
					value={settings.customSubsetSize}
					disabled={disabled}
					onChange={({ target: { value } }) =>
						onUpdateSettings({ customSubsetSize: Number(value) })
					}
				/>
				<div className="settings-help">
					Roles are hidden in this mode. Everyone sees the sampled word list,
					but only non-spies see the chosen word.
				</div>
			</div>
		)}
	</div>
);

export default Settings;
