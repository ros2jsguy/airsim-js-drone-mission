import { AirSim, Multirotor, Vector3 } from 'airsim-js';
import {
  CancelLastTaskAction,
  HoverAction,
  LandAction,
  MissionState,
  MoveToPositionAction, 
  ReturnHomeAction,
  RotateToYawAction,
  StopMotorsAction,
  TakeoffAction } from './actions';
import { LatchedSequence, Selector } from 'blueshell';
import { FlightPlanSequence, MissionControl } from './mission-control';
import { MissionEvent } from './events';

/**
 * The entry point for driving a drone mission setup, execution and teardown.
 * @returns a Promise<void> to await on 
 */
export async function main(shouldAbort = false): Promise<void> {
  // Create airsim client and connect to a server. 
  // Assumes AirSim server is on localhost.
  const airsim = new AirSim(Multirotor);
  const connected = await airsim.connect();
  console.log('AirSim connection: ', connected ? 'ESTABLISHED' : 'FAILED');
  if (!connected) exit(-1);

  // verify server connectivity
  const ping = await airsim.ping();
  console.log(`AirSim ping: ${ping ? "SUCCESS" : "FAIL"}`);
  if (!ping) exit(-1);

  // Set airsim simulation to a clean initial state.
  // Don't assume simulation is ready to go by default.
  await airsim.reset();

  // Get a list of drones hosted by the sim.
  const drones = await airsim.getVehicles();
  if (drones.length < 1) {
    console.log('No drones found in sim');
    return;
  }

  // Select the 1st drone in the list and set it
  // up for airsim-js api control.
  const drone = drones[0];
  await drone.enableApiControl();
  await drone.arm();
  await drone.setTraceLine([0,1,0,1],10);
  console.log('Drone info: ', drone);

  // Setup a missionstate
  let missionState = new MissionState(airsim, drone);
  missionState.debug = true;

  // Create the behavior tree for the flight plan.
  let mission = new Selector<MissionState, string>(
    'Mission',
    [
      // A rectangular flight-plan.
      new FlightPlanSequence(
        'FlightPlan',
        [
          new TakeoffAction('TakeoffAction', -2),

          // leg-1
          new MoveToPositionAction('MoveToPosition1', new Vector3(80, 0, -1.5)),
          // leg-2
          new RotateToYawAction('RotateTo270', 270, 1),
          new MoveToPositionAction('MoveToPosition2', new Vector3(80, -125, -1.5)),
          // leg-3
          new RotateToYawAction('RotateTo180', 180, 1),
          new MoveToPositionAction('MoveToPosition3', new Vector3(0, -125, -5)),
          // leg-4
          new RotateToYawAction('RotateTo90', 90, 1),
          new ReturnHomeAction('ReturnHome'),
          new HoverAction('Hover', 3),
          new RotateToYawAction('Rotate0', 0, 1),

          // Land and Stop
          new LandAction('Land', 5),
          new StopMotorsAction('StopMotors')
        ]),
      
      // Fallback plan when mission is aborted or an error occurs 
      new LatchedSequence<MissionState, MissionEvent>(
        'AbortProcedure',
        [
          new CancelLastTaskAction('CancelLastTask'),
          new HoverAction('Hover', 3),
          new LandAction('Land', 5),
          new StopMotorsAction('StopMotors')
        ])
    ]
  );

  // Create a mission controller with event listeners.
  let missionControl = new MissionControl('Mission', mission, missionState);
  missionControl.on('launch', () => console.log('Mission started'));
  missionControl.on('complete', () => {
    airsim.printLogMessage('MISSION: ', missionControl.status);
    console.log('Mission status: ', missionControl.status);

    // close the connection to the server; no further commands will be transmitted
    airsim.close();
    console.log('AirSim connection: CLOSED');
    exit();
  });

  // Let's do it - launch the drone
  missionControl.launch();

  if (shouldAbort) {
    setTimeout( () => {
      console.log('MANUAL ABORT INITIATED');
      missionControl.abort();
    }, 5000);
  }
}

function exit(exitCode = 0) {
  console.log('Exiting');
  process.exit(exitCode);
}

/**
 * Start this program, create a mission and launch it.
 * Optional CLI arg: 'abort' - causes mission to abort 5 seconds after launch
 */
main(process.argv.length > 2 && process.argv[2].toLowerCase() === 'abort');
