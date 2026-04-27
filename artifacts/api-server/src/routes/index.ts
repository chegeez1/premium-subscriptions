import { Router, type IRouter } from "express";
import healthRouter from "./health";
import linksRouter from "./links";
import toolsRouter from "./tools";

const router: IRouter = Router();

router.use(healthRouter);
router.use(linksRouter);
router.use(toolsRouter);

export default router;
