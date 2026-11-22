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
    // rim hold: stay put inside the next circle (by min(30, 0.3 R) + 5 m); leave when the moving edge would reach us
    rimHold: false, // 160c260 (on) scored 4.19 vs 4.58: passivity costs kills
    rimTravelMult: 1.4,
    rimSlackS: 6,
    rimSoftS: 1000, // no target: walk in as soon as we are outside the hold ring
    rimLeaveByEnd: true,
    rimOutsideOld: true, // outside the current circle: head for the old 0.7 R point (open ground, fewer detours)
    rimPathCap: 6000,
    idleStay: false, // squad mode: stand still when there is nothing to do instead of wandering
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
    // selective engage: only mechs that are close, weak, closing, aiming at or hitting us (keeps regen windows)
    selective: true,
    engageClose: 120,
    engageHpFrac: 0.5,
    engageClosingSpeed: 2,
    engageAllAfter: 200,
    // stalk: idle and healthy, walk toward the nearest known house bot until it is at laser range, then the
    // selective engage rule (engageClose) takes over. Goal is a cell at stalkRange from it with sight of it
    // and as hidden as possible from everyone else.
    stalk: true,
    stalkRange: 115,
    stalkHp: 0.7,
    stalkMaxEngaged: 1, // at most this many mechs hit us in the last 6 s
    stalkUntilRadius: 140, // off once the next circle is this small (the end game comes to us)
    stalkMemoryS: 10, // only tracks seen this recently
    stalkReplanS: 2,
    stalkSound: true, // nobody known: walk toward the latest mid/far gun or laser sound
    stalkSoundMid: 50,
    stalkSoundFar: 90,
    stalkSoundS: 4,
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
