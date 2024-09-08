<?php

function Travel_0_4_local()
{
	// symlink the icons folder
	Q_Utils::symlink(
		TRAVEL_PLUGIN_FILES_DIR.DS.'Travel'.DS.'icons',
		TRAVEL_PLUGIN_WEB_DIR.DS.'img'.DS.'icons',
		true
	);
}

Travel_0_4_local();
