import express from 'express';
import { contactController } from '../controllers/contactController.js';

const router = express.Router();

router.post('/submit', contactController.submitInquiry);
router.post('/newsletter', contactController.subscribeNewsletter);

export default router;
