import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { useI18n } from "../locales";

import Loading from "../components/Loading";
import Swal from "sweetalert2";
import { lockedMessage } from "../utils/misc";

const REPO_URL = "https://github.com/NightMachinery/spyfall";
const README_URL = `${REPO_URL}/blob/dev/README.md`;
const ISSUES_URL = `${REPO_URL}/issues`;

const Home = ({ loading }) => {
	const router = useRouter();
	const [newGameLoading, setNewGameLoading] = useState(false);
	const t = useI18n();
	const onNewGame = async (e) => {
		e.preventDefault();
		setNewGameLoading(true);

		try {
			const res = await fetch(`${window.location.origin}/new`, {
				method: "POST",
				headers: {
					Accept: "application/json",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({}),
			});

			if (res.status === 200) {
				const { gameCode } = await res.json();
				router.push(`/${gameCode}`);
			} else if (res.status === 423) {
				const { minutes } = await res.json();
				setNewGameLoading(false);

				Swal.fire(lockedMessage(minutes));
			} else {
				throw new Error(`${res.status} ${res.statusText}`);
			}
		} catch (error) {
			console.error(error);
			Swal.fire(String(error));
			setNewGameLoading(false);
		}
	};

	return (
		<div className="main-menu">
			<div
				style={{
					position: "relative",
					margin: "1em auto 0",
					width: "fit-content",
				}}
			>
				<h3>{t("ui.welcome to spyfall")}</h3>
				<div className="subtitle">Open source party-game rooms you can self-host.</div>
			</div>
			<hr />

			{(loading || newGameLoading) && <Loading />}
			{!loading && (
				<>
					<div className="button-container">
						<Link href="/join">
							<button id="btn-join-game" className="btn-large">
								{t("ui.join game")}
							</button>
						</Link>
						<button id="btn-new-game" className="btn-large" onClick={onNewGame}>
							{t("ui.new game")}
						</button>
					</div>
					<div className="button-container-vertical">
						<div style={{ width: "100%" }}>
							<Link href="/how-to-play">
								<button className="btn-small btn-vertical">How to Play</button>
							</Link>
						</div>
						<a
							href={README_URL}
							target="_blank"
							rel="noopener noreferrer"
							style={{ width: "100%" }}
						>
							<button className="btn-small btn-vertical">Project README</button>
						</a>
						<a
							href={ISSUES_URL}
							target="_blank"
							rel="noopener noreferrer"
							style={{ width: "100%" }}
						>
							<button className="btn-small btn-vertical">Report an Issue</button>
						</a>
					</div>
				</>
			)}
		</div>
	);
};

export default Home;
