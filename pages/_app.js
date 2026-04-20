import React, { useEffect, useState, useContext } from "react";
import Router from "next/router";
import withDarkMode from "next-dark-mode";
import { useDarkMode } from "next-dark-mode";

import Page from "../components/Page";
import { initGA, logPageView } from "../utils/analytics";

import "@fontsource/open-sans";
import "@fontsource/raleway";
import "@fontsource/raleway/500.css";

import "../styles/sanitize.css";
import "skeleton-css/css/skeleton.css";
import "../styles/styles.scss";

import { I18nProvider } from "../locales";

function MyApp({ Component, pageProps }) {
	const {
		autoModeActive,
		autoModeSupported,
		darkModeActive,
		switchToAutoMode,
		switchToDarkMode,
		switchToLightMode,
	} = useDarkMode();

	const [loading, setLoading] = useState(false);
	useEffect(() => {
		initGA();
		logPageView();

		const loadingStart = () => setLoading(true);
		const loadingStop = () => {
			logPageView();
			setLoading(false);
		};

		Router.events.on("routeChangeStart", loadingStart);
		Router.events.on("routeChangeComplete", loadingStop);

		return () => {
			Router.events.off("routeChangeStart", loadingStart);
			Router.events.off("routeChangeComplete", loadingStop);
		};
	}, []);

	const onThemeToggle = () =>
		darkModeActive ? switchToLightMode() : switchToDarkMode();

	return (
		<I18nProvider locale={pageProps?.locale} fallback="en">
			<Page onThemeToggle={onThemeToggle} darkModeActive={darkModeActive}>
				<Component
					{...pageProps}
					loading={loading}
					onThemeToggle={onThemeToggle}
				/>
				{darkModeActive && (
					<style jsx global>{`
						body {
							background-color: #121212;
							color: white;
							transition: background-color 0.2s linear;
						}

						.footer,
						.language-list,
						.settings-help,
						.copy-feedback,
						.event-cue-description,
						.btn-toggle-status {
							color: #ddd;
						}
						button:hover,
						button:active,
						button:focus,
						.swal2-container .swal2-title,
						.swal2-container .swal2-html-container {
							color: white;
						}
						.swal2-container .swal2-popup {
							background-color: #222;
						}
						button:active {
							background-color: #555;
						}
						button {
							background-color: #222;
							color: white;
							border-color: #aaa;
							transition: background-color 0.2s linear;
						}

						input[type="text"],
						input[type="number"],
						select,
						textarea,
						.box,
						.lobby-player-list > .player-box,
						.question-active-card,
						.status-container,
						.access-code > span {
							border-color: #aaa !important;
							background-color: #333 !important;
							color: white !important;
						}
						input::placeholder,
						textarea::placeholder {
							color: #bbb !important;
						}
						.question-helper label,
						.event-cue-group-option,
						.status-container-content {
							color: white;
						}
						.question-active-card,
						.status-container {
							box-shadow: none;
						}
						.game-countdown {
							color: #ddd;
						}
						.access-code,
						.access-code > span {
							color: #fff;
						}
						.event-cue-toast {
							background: rgba(12, 12, 12, 0.96);
							border: 1px solid #555;
						}
						.box-striked {
							background-color: #333 !important;
							color: grey !important;
						}
					`}</style>
				)}
			</Page>
		</I18nProvider>
	);
}

// Only uncomment this method if you have blocking data requirements for
// every single page in your application. This disables the ability to
// perform automatic static optimization, causing every page in your app to
// be server-side rendered.
//
// MyApp.getInitialProps = async (appContext) => {
//   // calls page's `getInitialProps` and fills `appProps.pageProps`
//   const appProps = await App.getInitialProps(appContext);
//
//   return { ...appProps }
// }

export default withDarkMode(MyApp);
