<?php

/**
 * @module Users
 */
class Travel_Exception_Routing extends Q_Exception
{
	/**
	 * Complains that there was an error obtaining routing information
	 * @class Travel_Exception_Routing
	 * @constructor
	 * @extends Q_Exception
	 * @param {string} $message
	 */
};

Q_Exception::add('Travel_Exception_Routing', 'Routing error: {{explanation}}');
