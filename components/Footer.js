import React from "react";

const REPO_URL = "https://github.com/NightMachinery/spyfall";

const Footer = () => (
	<div className="footer">
		Open source Spyfall
		<br />
		<a href={REPO_URL} target="_blank" rel="noopener noreferrer">
			View on GitHub
		</a>
	</div>
);

export default Footer;
