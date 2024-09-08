<?php

/**
 * @module Users
 */
class Travel_Exception_StateTransition extends Q_Exception
{
	/**
	 * An exception is raised if state transition is wrong
	 * @class Travel_Exception_StateTransition
	 * @constructor
	 * @extends Q_Exception
	 * @param {string} $currentState
	 * @param {string} $state
	 */
};

Q_Exception::add('Travel_Exception_StateTransition', "Can't go from {{currentState}} to {{state}}");
