'use strict'

const express = require('express')
const router = express.Router()

const { authenticate, requireRestaurantAdmin } = require('../middleware/auth')
const controller = require('../controllers/adminAssistant.controller')

// Same gate as every other restaurant-admin route.
router.use(authenticate, requireRestaurantAdmin)

// Says what it would do. Writes nothing.
router.post('/preview', controller.preview)

// Carries it out, after the admin has seen the preview and confirmed.
router.post('/apply', controller.apply)

module.exports = router
