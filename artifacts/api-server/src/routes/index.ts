import { Router, type IRouter } from "express";
import healthRouter from "./health";
import scriptRouter from "./script.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(scriptRouter);

export default router;
