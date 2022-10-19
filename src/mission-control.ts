import { BaseNode, LatchedSequence, rc, ResultCode } from "blueshell";
import EventEmitter from "events";
import { AirSimAction, MissionState } from "./actions";
import { MissionEvent } from "./events";

const TICK_FREQ = 2; // Hz

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
  launch(): void {
    if (this.isActive() || (this.status && this.status !== rc.RUNNING)) {
      throw new Error('Mission already running');
    }

    this._status = rc.RUNNING;
    this.emit('launch', this.missionState);
    this._timer = 
      setInterval(() => {
        if (!this.isComplete()) {
          this._status = this.sendBTEvent(this.missionState,'tic');
        } else {
          this.stopTic();
        }
      }, 1000 / TICK_FREQ);
  }

  /**
   * Stop the mission execution and abort the flight-plan. The internal timer is
   * terminated and no further 'tick' events are sent to the behavior-tree.
   * @returns The current status code if the controller has been started.
   */
  abort() {
    if (this.isActive()) {
      this._status = this.sendBTEvent(this.missionState,'abort');
      this.emit('abort', this.missionState);
    } else if (!this.status) {
      console.log('Mission has not been started');
    } else if (this.isComplete()) {
      console.log('Mission already completed.');
    }
  }

  private sendBTEvent(state: MissionState, event: MissionEvent): ResultCode {
    return this.mission.handleEvent(state, event);
  }

  isActive(): boolean {
    return !!this._timer;
  }

  isComplete(): boolean {
    return (this.status ?? rc.RUNNING) !== rc.RUNNING;  
  }

  get status(): ResultCode | undefined{
    return this._status;
  }

  protected stopTic() {
    clearInterval(this._timer);
    this._timer = undefined;
    this.emit('complete', this.missionState);
  }

  on(event: MissionEvent, listener: (state: MissionState) => void) {
    return this._eventEmitter.on(event, listener);
  }

  protected emit(event: MissionEvent, state: MissionState) {
    this._eventEmitter.emit(event, state);
  }

  removeListener(event: MissionEvent, listener: (state: MissionState) => void) {
    return this._eventEmitter.removeListener(event, listener);
  }
}


/**
 * A latched sequence of AirSim actions that make up a flight plan. 
 * If at any point a child node of this sequence fails, the 
 * sequence will always fail hereafter. This behavior forces
 * an aborted flight plan to procedue to the mission's
 * abort procedure.
 */
 export class FlightPlanSequence extends LatchedSequence<MissionState, MissionEvent> {

  private aborted = false;

  constructor(name: string, actions: AirSimAction[]) {
    super(name, actions);
  }

  handleEvent(state: MissionState, event: MissionEvent) {
    if (event === 'abort') {
      this.aborted = true;
    }

    return super.handleEvent(state, event);
  }

  /**
   * Return true if this Node should proceed handling the event. false otherwise.
   * @param state
   * @param event
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected precondition(state: MissionState, event: MissionEvent): boolean {
    return !this.isAborted();
  }

  protected _afterEvent(res: ResultCode, state: MissionState, event: MissionEvent): ResultCode {
    return super._afterEvent(this.isAborted() ? rc.FAILURE : res, state, event);
  }

  isAborted(): boolean {
    return this.aborted;
  }
}