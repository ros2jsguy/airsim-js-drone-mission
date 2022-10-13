import { AirSim, Multirotor, Vector3 } from 'airsim-js';
import { LandAction, MissionState, MoveOnPathAction, MoveToPositionAction, 
    MoveToZAction, ReturnHomeAction, StopMotorsAction, TakeoffAction } from './actions';
import { rc, LatchedSelector, LatchedSequence, ResultCode } from 'blueshell';
import { MissionControl, MissionEvent } from './mission-control';

/**
 * The entry point for driving a drone mission setup, execution and teardown.
 * @returns a Promise<void> to await on 
 */
async function main(): Promise<void> {
  // Create airsim client and connect to a server. 
  // Assumes AirSim server is on localhost.
  const airsim = new AirSim(Multirotor);
  const connected = await airsim.connect();
  console.log('AirSim connection: ', connected ? 'ESTABLISHED' : 'FAILED');
  if (!connected) {
    console.log('Exiting');
    process.exit(-1);
  }

  // verify server connectivity
  const ping = await airsim.ping();
  console.log(`AirSim ping: ${ping ? "SUCCESS" : "FAIL"}`);
  if (!ping) {
    console.log('Exiting');
    process.exit(-1);
  }

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
  let mission = new LatchedSelector<MissionState, string>(
    'Mission',
    [
      // A rectangular flight-plan.
      new LatchedSequence<MissionState, string>(
        'FlightPlan',
        [
          new TakeoffAction('TakeoffAction', -2),
          // new MoveToPositionAction('MoveToPosition1Action', new Vector3(80, 0, -1.5)),
          // new MoveToPositionAction('MoveToPosition2Action', new Vector3(80, -125, -1.5)),
          // new MoveToPositionAction('MoveToPosition3Action', new Vector3(0, -125, -5)),
          new MoveOnPathAction(
            'FlyPathAction',
            [
              new Vector3(80, 0, -1.5),    // side-1 of rectangle
              new Vector3(80, -130, -1.5), // side-2 of rectangle
              new Vector3(0, -130, -5)     // side-3 of rectangle
            ]
          ),
          new ReturnHomeAction('ReturnHomeAction'),
          new LandAction('LandAction'),
          new StopMotorsAction('StopMotorsAction')
        ]),
      
      // Fallback plan when mission is aborted or an error occurs 
      new LatchedSequence<MissionState, string>(
        'AbortProcedure',
        [
          new LandAction('LandAction'),
          new StopMotorsAction('StopMotorsAction')
        ])
    ]
  );

  // Create a mission controller with event listeners.
  let missionControl = new MissionControl('Mission', mission, missionState);
  missionControl.on('started', () => console.log('Mission started'));
  missionControl.on('stopped', () => {
    // close the connection to the server; no further commands will be transmitted
    airsim.close();

    console.log('Mission status: ', missionControl.status);
    console.log('AirSim connection: CLOSED');
  });

  // Let's do it - launch the drone
  missionControl.start();
}

main();