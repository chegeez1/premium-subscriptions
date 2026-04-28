import { Router, type IRouter } from "express";
import healthRouter from "./health";
import linksRouter from "./links";
import toolsRouter from "./tools";
import ttsRouter from "./tts";

const router: IRouter = Router();

router.use(healthRouter);
router.use(linksRouter);
router.use(toolsRouter);
router.use(ttsRouter);

export default router;
