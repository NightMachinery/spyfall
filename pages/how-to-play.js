import React from "react";
import Link from "next/link";

const externalHelpEnabled = process.env.NEXT_PUBLIC_ENABLE_EXTERNAL_HELP === "1";

const HowToPlay = () => {
	return (
		<>
			<div className="main-menu">
				<h3>How to Play Spyfall</h3>
				<hr />
				<div>
					<p>
						Spyfall is a social deduction game for private rooms. It works well with
						3 to 8 players, and many groups prefer 5 or 6.
					</p>
					<p>
						Depending on room settings, a round can have zero, one, or multiple
						spies. Non-spies receive the shared secret word from the selected
						wordpack. Spies do not receive the word.
					</p>
					{externalHelpEnabled ? (
						<>
							<p>Optional external help:</p>
							<div style={{ textAlign: "center" }}>
								<iframe
									src="https://www.youtube.com/embed/O7W0rH6YpeI"
									className="embed-responsive-item"
								/>
							</div>
						</>
					) : (
						<p>
							This deployment keeps the gameplay fully intranet-friendly, so it does
							not embed external videos or PDFs.
						</p>
					)}
					<br />
					<p>
						Players ask each other two-choice questions and try to sound informed
						without being too specific. The suggested asker and target help rotate
						the conversation, but anyone eligible can still ask manually.
					</p>
					<p>
						The non-spies win by correctly identifying every spy. A revealed spy can
						no longer ask or answer questions, but may still use any remaining
						guesses to name the hidden word. Spies also win if a
						guess is correct before the round ends.
					</p>
					<p>
						Players can also start accusation votes, including terminal votes such
						as declaring that there are no spies left.
					</p>
					{externalHelpEnabled ? (
						<p>
							If you want more detail, you can also read the official board-game
							rulebook{" "}
							<a
								href="https://www.cryptozoic.com/sites/default/files/icme/u30695/spy_rules_eng_0.pdf"
								target="_blank"
								rel="noopener noreferrer"
							>
								here
							</a>
							.
						</p>
					) : (
						<p>
							The written summary above is the built-in guide for self-hosted
							deployments.
						</p>
					)}

					<style jsx>{`
						text-align: left;
					`}</style>
				</div>
			</div>
			<Link href="/">
				<button>Back to Spyfall</button>
			</Link>
		</>
	);
};

export default HowToPlay;
