// Every tunable threshold lives here so a board ablation is a one-line change.
export const PARAMS = {
  common: {
    guardMs: 30,
    quietUntil: 20, // opening: no fights unless shot or crowded
    openingShootRange: 50,
    laserPickupRange: 250,
    lightningPickupRange: 120,
    cubeDetourIdle: 60,
    cubeDetourFight: 25,
    cubeCap: 10,
    pathCap: 6000,
    replanS: 0.5,
    replanGoalMove: 8,
    zoneInsideFrac: 0.3,
    zoneSafety: 1.4,
    zoneSlackS: 6,
    zoneDiscardLead: 15,
    dodgeHorizon: 0.6,
    dodgeMargin: 1.2,
    longShotRange: 130,
    longShotLateral: 6,
    laserHoldMax: 1.8,
    laserKillFrac: 0.7,
    strafeMin: 0.4,
    strafeMax: 1.0,
    breakSight: true,
    breakSightChargeS: 0.4,
    breakSightCoverM: 8,
    berserk: false,
    detectMode: false, // practice is always squad mode; a false ffa latch makes the bot passive
    dropsInSquad: false,
    crateShots: false,
    crateShotRange: 25,
  },
  squad: {
    maxTargetRange: 240,
    rangeLaser: 110,
    rangeGun: 70,
    rangeLightning: 30,
    finishRange: 25,
    finishTargetFrac: 0.35,
    finishSelfFrac: 0.45,
    retreatCrowd: 2,
    retreatCrowdRange: 160,
    retreatHpCrowd: 0, // retreat off: hunters know where we are, so backing off only stops our damage
    retreatHpAlone: 0,
    retreatCancelTarget: 0.25,
    retreatS: 1.5,
  },
  ffa: {
    quietUntil: 60,
    keepAway: 150,
    engageHpFrac: 0.5,
    engageClose: 50,
    breakOffHp: 0.55,
    breakOffCover: 20,
    reengageHp: 0.9,
    lateAlive: 4,
    lateRadius: 70,
  },
}
export type Params = typeof PARAMS

export const UPGRADES_SQUAD = ["plating", "laser_damage", "gun_rate", "gun_damage", "armor", "laser_charge", "nanites", "servos", "gyros"]
export const UPGRADES_FFA = ["plating", "nanites", "armor", "laser_damage", "servos", "gun_rate", "gun_damage", "gyros"]
// Never useful to us: anything for the mortar.
export const UPGRADES_AVOID = ["mortar_splash", "mortar_reload", "mortar_velocity"]
