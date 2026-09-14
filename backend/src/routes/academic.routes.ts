import { Router } from 'express';
import {
  getColleges,
  getBranchesByCollege,
  getSubjects,
} from '../controllers/academic.controller.js';

const router = Router();

router.get('/colleges', getColleges);
router.get('/colleges/:collegeId/branches', getBranchesByCollege);
router.get('/subjects', getSubjects);

export default router;
