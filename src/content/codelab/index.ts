import type { CodeChallenge } from './types';
import { codeLabSweeps } from './sweeps';
import { clarkeChallenge } from './clarke';
import { parkChallenge } from './park';
import { inverseParkChallenge } from './inversePark';
import { piStepChallenge } from './piStep';
import { svpwmDutyChallenge } from './svpwmDuty';
import { deadtimeVoltChallenge } from './deadtimeVolt';
import { lpfStepChallenge } from './lpfStep';
import { notchCoeffChallenge } from './notchCoeff';
import { mtpaIdChallenge } from './mtpaId';
import { elecAngleChallenge } from './elecAngle';
import { threePhaseGenChallenge } from './threePhaseGen';
import { saliencyRatioChallenge } from './saliencyRatio';
import { vfRampChallenge } from './vfRamp';
import { unbalanceChallenge } from './unbalance';
import { thdChallenge } from './thd';
import { copEerChallenge } from './copEer';

/** 全部编程挑战（按模块序 01→16，16/16 模块全覆盖）。新增题目：单独文件 + 在此注册。 */
export const codeChallenges: CodeChallenge[] = [
  elecAngleChallenge,
  threePhaseGenChallenge,
  clarkeChallenge,
  parkChallenge,
  piStepChallenge,
  inverseParkChallenge,
  svpwmDutyChallenge,
  deadtimeVoltChallenge,
  notchCoeffChallenge,
  lpfStepChallenge,
  mtpaIdChallenge,
  unbalanceChallenge,
  saliencyRatioChallenge,
  vfRampChallenge,
  thdChallenge,
  copEerChallenge,
].map((c) => ({ ...c, sweep: codeLabSweeps[c.id] }));

export function challengesForModule(moduleId: string): CodeChallenge[] {
  return codeChallenges.filter((c) => c.moduleId === moduleId);
}
