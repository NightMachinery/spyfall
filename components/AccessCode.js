import React, { useState } from "react";
import { useI18n } from "../locales";

const AccessCode = ({ code }) => {
	const t = useI18n();
	const [copyState, setCopyState] = useState("idle");

	const handleCopy = async () => {
		if (typeof window === "undefined") return;
		const roomUrl = `${window.location.origin}/${code}`;

		try {
			if (navigator.clipboard?.writeText) {
				await navigator.clipboard.writeText(roomUrl);
			} else {
				const textarea = document.createElement("textarea");
				textarea.value = roomUrl;
				textarea.setAttribute("readonly", "");
				textarea.style.position = "absolute";
				textarea.style.left = "-9999px";
				document.body.appendChild(textarea);
				textarea.select();
				document.execCommand("copy");
				document.body.removeChild(textarea);
			}

			setCopyState("copied");
			setTimeout(() => setCopyState("idle"), 1500);
		} catch (_error) {
			setCopyState("failed");
			setTimeout(() => setCopyState("idle"), 2000);
		}
	};

	return (
		<>
			<div className="access-code">
				{t("ui.access code")}: <span>{code}</span>
			</div>
			<div className="access-code-actions">
				<button className="btn-small" onClick={handleCopy}>
					Copy room URL
				</button>
				{copyState === "copied" && <span className="copy-feedback">Copied!</span>}
				{copyState === "failed" && (
					<span className="copy-feedback">Copy failed</span>
				)}
			</div>
			<style>{`
				.access-code {
					margin: 0.8em;
					margin-bottom: 0.5em;
				}
				.access-code > span {
					box-shadow: 0 0 10pt 1pt #d3d3d3;
					padding: 0.4em;
				}
				.access-code-actions {
					margin-bottom: 1.5em;
				}
				.copy-feedback {
					margin-left: 0.5em;
					color: #666;
					font-size: 0.9em;
				}
			`}</style>
		</>
	);
};

export default AccessCode;
