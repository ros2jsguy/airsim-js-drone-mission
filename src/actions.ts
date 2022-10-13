import { AirSim, Multirotor, Vector3 } from 'airsim-js';
import { rc, BlueshellState, ResultCode, RunningAction } from 'blueshell';

const HOVER_HT = -3;
const HOVER_HT_MARGIN = 1;
const DEFAULT_MOVE_VELOCITY = 5;
const POS_MARGIN = 5; // meters

/**
 * A Blackboard, i.e., table of properties and config settings
 * shared between behavior-tree nodes.
 */
export class MissionState implements BlueshellState {
  errorReason?: Error | undefined;
  __blueshell: any;
  debug: boolean;
  hoverHt: number;

  constructor(public airsim: AirSim<Multirotor>, public drone: Multirotor) {
    this.hoverHt = HOVER_HT;
    this.debug = false;
  }
}

/**
 * An abstract behavior-tree action node that wraps a promise-based airsim-js api. 
 */
export abstract class AirSimAction extends RunningAction<MissionState, string> {
  status: ResultCode | undefined;
  protected promise: Promise<unknown> | unknown;

  constructor(name: string) {
    super(name);
  }

  protected activate(state: MissionState, event: string): ResultCode {
    if (state.debug) console.log(`Starting ${this.name}`);
    return rc.RUNNING;
  }

  /**
   * Test if action is completed
   * @param event 
   * @param state 
   * @returns true if action is in a completed state; false otherwise
   */
  protected isCompletionEvent(event: string, state: MissionState): boolean {
    return this.status !== rc.RUNNING;
  }
}

/**
 * Behavior-tree action to move a drone to a Z (NED) elevation.
 */
export class MoveToZAction extends AirSimAction {

  constructor(name: string, public targetHt: number, public targetMargin = HOVER_HT_MARGIN) {
    super(name);
  }

  protected activate(state: MissionState, event: string): ResultCode {
    super.activate(state,event);
    this.status = rc.RUNNING;
    this.promise = state.drone.moveToZ(this.targetHt, this.targetHt > 5 ? 5 : 2.5).then( result => {
        state.drone.getPose().then( pose => {
            this.status = 
              Math.abs(pose.position.z - this.targetHt) <= this. targetMargin ? 
                rc.SUCCESS : 
                rc.FAILURE;
          })
      }).catch( error => {
        state.errorReason = error.message;
        this.status = rc.ERROR;
      });

    return this.status;
  }
}

/**
 * A behavior-tree action to fly a drone from a resting ground state (elevation)
 * up to a specified height and hover.
 */
export class TakeoffAction extends MoveToZAction {
  constructor(name: string, public targetHt = HOVER_HT) {
    super(name, targetHt);
  }

  protected activate(state: MissionState, event: string): ResultCode {
    state.hoverHt = this.targetHt;
    return super.activate(state,event);
  }
}

/**
 * A behavior-tree action to immediate land a drone
 * at it's current position.
 */
export class LandAction extends MoveToZAction {
  constructor(name: string) {
    super(name, 0.5, 0.01);
  }
}

/**
 * A behavior-tree action to fly a drone to a specified
 * 3D position (NED); 
 */
export class MoveToPositionAction extends AirSimAction {

  constructor(name: string, public targetPos: Vector3, public velocity = DEFAULT_MOVE_VELOCITY) {
    super(name);
  }

  protected activate(state: MissionState, event: string): ResultCode {
    super.activate(state,event);
    this.status = rc.RUNNING;
    this.promise = state.drone.moveToPosition(this.targetPos, this.velocity).then( result => {
        state.drone.getPose().then( pose => {
            this.status = 
              Math.abs(pose.position.distanceTo(this.targetPos)) <= POS_MARGIN ?
                rc.SUCCESS :
                rc.FAILURE;
          })
      }).catch( error => {
        state.errorReason = error.message;
        this.status = rc.ERROR;
      });

    return this.status;
  }
}

/**
 * Behavior-tree action that instructs a drone to immediately
 * fly to it's point of origin and hover at a safe altitude.
 */
export class ReturnHomeAction extends MoveToPositionAction {
  constructor(name: string) {
    super(name, new Vector3(0,0,HOVER_HT));
  }

  protected activate(state: MissionState, event: string): ResultCode {
    this.targetPos.z = state.hoverHt;
    return super.activate(state,event);
  }
}

/**
 * A behavior-tree action that sets a drone's target velocity in 3 dimensions.
 */
export class MoveByVelocityAction extends AirSimAction {

  constructor(name: string, public targetVelocity: Vector3, public duration: number) {
    super(name);
  }

  protected activate(state: MissionState, event: string): ResultCode {
    super.activate(state,event);
    this.status = rc.RUNNING;
    this.promise = 
      state.drone.moveByVelocity(
          this.targetVelocity.x,
          this.targetVelocity.y,
          this.targetVelocity.z,
          this.duration).then( result => {
        this.status = rc.SUCCESS;
      }).catch( error => {
        state.errorReason = error.message;
        this.status = rc.ERROR;
      });

    return this.status;
  }
}

/**
 * A behavior-tree action that stops a drones motors.
 */
export class StopMotorsAction extends MoveByVelocityAction {
  constructor(name: string) {
    super(name, new Vector3(0,0,0), 1);
  }
}

/**
 * A behavior-tree action that instructs a drone to fly a path
 * defined by an ordered list of waypoints at a target velocity m/s.
 */
export class MoveOnPathAction extends AirSimAction {

  constructor(name: string, public waypoints: Vector3[], public velocity = DEFAULT_MOVE_VELOCITY) {
    super(name);
  }

  protected activate(state: MissionState, event: string): ResultCode {
    super.activate(state,event);
    this.status = rc.RUNNING;
    this.promise = state.drone.moveOnPath(this.waypoints, this.velocity).then( result => {
       this.status = rc.SUCCESS;
      }).catch( error => {
        state.errorReason = error.message;
        this.status = rc.ERROR;
      });

    return this.status;
  }
}