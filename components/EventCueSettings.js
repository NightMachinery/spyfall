import HideableContainer from "./HideableContainer";
import {
	DEFAULT_EVENT_CUE_PREFERENCES,
	EVENT_CUE_GROUPS,
} from "../utils/localEventCues";

const EventCueSettings = ({ cuePreferences, onChange, onPlayTestCue }) => {
	const nextPreferences = cuePreferences || DEFAULT_EVENT_CUE_PREFERENCES;

	const updateGroup = (groupId, enabled) => {
		onChange({
			...nextPreferences,
			groups: {
				...nextPreferences.groups,
				[groupId]: enabled,
			},
		});
	};

	return (
		<HideableContainer title="Event Cues" initialHidden={true}>
			<div className="status-container-content event-cue-settings">
				<div className="settings-help">
					These cues are local to this browser/device. Sound and visual cues are
					enabled by default.
				</div>
				<label>
					<input
						type="checkbox"
						checked={nextPreferences.enabled}
						onChange={({ target: { checked } }) =>
							onChange({ ...nextPreferences, enabled: checked })
						}
					/>
					<span className="label-body">Enable all event cues</span>
				</label>
				<div className="settings-help" style={{ marginBottom: "0.75em" }}>
					Choose exactly which event sets should produce cues.
				</div>
				<div className="event-cue-group-list">
					{EVENT_CUE_GROUPS.map((group) => (
						<label key={group.id} className="event-cue-group-option">
							<input
								type="checkbox"
								checked={Boolean(nextPreferences.groups[group.id])}
								disabled={!nextPreferences.enabled}
								onChange={({ target: { checked } }) =>
									updateGroup(group.id, checked)
								}
							/>
							<span className="label-body">
								<strong>{group.label}</strong>
								<span className="event-cue-description">
									{group.description}
								</span>
							</span>
						</label>
					))}
				</div>
				<button className="btn-small" onClick={onPlayTestCue}>
					Play test cue
				</button>
			</div>
		</HideableContainer>
	);
};

export default EventCueSettings;
