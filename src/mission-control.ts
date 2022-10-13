import { BaseNode, rc, ResultCode } from "blueshell";
import EventEmitter from "events";
import { AirSimAction, MissionState } from "./actions";

const TICK_FREQ = 2; // Hz

/**
 * Events emitted by MissonControl
 */
export type MissionEvent = 'started' | 'stopping' | 'stopped';

// todo: implement abort flow

/**
 * Executor of a flight-plan. A behavior-tree is used to represent the flight-plan.
 * The behavior-tree is built up of custom airsim actions, a.k.a. tasks, that
 * wrap the airsim-js api. When the mission is started a tick event is sent to
 * the behavior at regular frequency, e.g., 2 Hz (every 500ms) until the 
 * behavior-tree returns a terminal resultcode such as SUCCESS, FAILURE or ERROR.
 * A MissionControl instance can only be run once.
 */
export class MissionControl {
  private _eventEmitter: EventEmitter;
  private _timer: NodeJS.Timer | undefined;
  private _status: ResultCode | undefined;

  /**
   * Create a new instance.
   * @param name - Name of this controller
   * @param mission - A behavior-tree represenation of the mission.
   * @param missionState - Configuration and state info about the mission.
   */
  constructor(
    public name: string, 
    public mission: BaseNode<MissionState,string>,
    public missionState: MissionState) {
      this._eventEmitter = new EventEmitter();
  }

  /**
   * Start execution of the flight-plan. This will launch an
   * internal timer that sends 'tick' events to the behavior-tree at 2Hz. 
   * Emits the 'started' event.
   * @throws Error - When attempting to start MissionController that
   *  has already been started.
   */
  start(): void {
    if (this.isRunning() || (this.status && this.status !== rc.RUNNING)) {
      throw new Error('Mission already running');
    }

    this._status = rc.RUNNING;
    this._eventEmitter.emit('started');
    this._timer = 
      setInterval(() => {
        if (this.shouldContinueMission()) {
          this._status = this.mission.handleEvent(this.missionState,'tic');
        } else {
          this.stop();
        }
      }, 1000 / TICK_FREQ);
  }

  /**
   * Stop the mission execution and abort the flight-plan. The internal timer is
   * terminated and no further 'tick' events are sent to the behavior-tree.
   * @returns The current status code if the controller has been started.
   */
  stop(): ResultCode | undefined {
    if (!this.status) {
      console.log('Mission has not been started');
    } else if (this.isRunning()) {
      clearInterval(this._timer);
      this._timer = undefined;
      this._eventEmitter.emit('stopped');
    }
    return this.status;
  }

  isRunning(): boolean {
    return !!this._timer;
  }

  isStopped(): boolean {
    return !this.isRunning();
  }

  shouldContinueMission(): boolean {
    return !this.status ||
      (this.status === rc.RUNNING &&
       !this.missionState.errorReason);  
  }

  on(event: MissionEvent, listener: (...args: any[]) => void) {
    return this._eventEmitter.on(event as string, listener);
  }

  get status(): ResultCode | undefined{
    return this._status;
  }
}