const EventCueToastStack = ({ toasts }) => {
	if (!toasts?.length) return null;

	return (
		<div className="event-cue-toast-stack" aria-live="polite" aria-atomic="true">
			{toasts.map((toast) => (
				<div key={toast.id} className="event-cue-toast">
					<div className="event-cue-toast-title">{toast.title}</div>
					{toast.detail && (
						<div className="event-cue-toast-detail">{toast.detail}</div>
					)}
				</div>
			))}
		</div>
	);
};

export default EventCueToastStack;
