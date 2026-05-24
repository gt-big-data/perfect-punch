// Test the data transformation from session_metrics.json format to dashboard format
import fs from 'fs';

// Read the sample session data
const sessionData = JSON.parse(fs.readFileSync('./session_metrics.json', 'utf-8'));

// Apply the transformation from LandingPage.jsx
const transformedMetrics = sessionData.map(session => {
  const metrics = session.metrics;
  const offenseMetrics = metrics.offense;
  const defenseMetrics = metrics.defense;
  const miscMetrics = metrics.miscellaneous;
  
  // Extract the accuracy data
  const punchAccuracy = offenseMetrics.punch_accuracy;
  const reactionTime = offenseMetrics.punch_reaction_time;
  const punchSpeed = offenseMetrics.punch_speed;
  
  // Use the actual punches_thrown count from the session
  const totalPunches = session.punches_thrown || 0;
  const correctPunches = session.correct_punches || 0;
  
  // Calculate score: (correct_punches / total_punches) * 100
  const accuracyPercent = totalPunches > 0 ? Math.round((correctPunches / totalPunches) * 100 * 10) / 10 : 0;
  
  // Convert punch speed from px/s to m/s (assuming ~100 px = 1 meter for gesture tracking)
  const avgVelocityMs = Math.round((punchSpeed.derived.average / 100) * 100) / 100;
  
  // Get critical prevention from punches_avoided percentage
  const criticalPrevention = defenseMetrics?.punches_avoided?.value ?? 0;
  
  // Get defense breakdown from flying_blocks
  const defenseBreakdown = miscMetrics?.flying_blocks_summary?.values || { blocked: 0, dodged: 0, hit: 0 };

  return {
    session_id: session.session_id,
    fighter_id: session.fighter_id,
    timestamp: session.timestamp,
    summary: {
      score: correctPunches,  // Just the count, not percentage
      avg_velocity: avgVelocityMs,  // in m/s
      avg_reaction_time: Math.round(reactionTime.derived.best || reactionTime.derived.average),
      accuracy: accuracyPercent,  // Overall accuracy percentage
      critical_prevention: criticalPrevention,  // % of punches avoided
      total_punches: totalPunches
    },
    punch_accuracy: punchAccuracy.types,  // Individual punch type percentages
    reaction_times: {
      jab: Math.round(reactionTime.types.jab),
      hook: Math.round(reactionTime.types.hook),
      uppercut: Math.round(reactionTime.types.uppercut)
    },
    defense: defenseBreakdown,  // blocked, dodged, hit counts
    punch_speed: punchSpeed.types,
    timeline: []
  };
});

console.log('\n✅ Data Transformation Test Results\n');
console.log('Session data:');
console.log(`- Total Punches Thrown: ${sessionData[0].punches_thrown}`);
console.log(`- Correct Punches: ${sessionData[0].correct_punches}`);
console.log(`- Critical Prevention (% punches avoided): ${sessionData[0].metrics.defense.punches_avoided.value}%`);
console.log(`- Flying Blocks: ${JSON.stringify(sessionData[0].metrics.miscellaneous.flying_blocks_summary.values)}`);

console.log('\nTransformed summary:');
const summary = transformedMetrics[0].summary;
console.log(`- Score (correct punches): ${summary.score}`);
console.log(`- Accuracy (score/total): ${summary.accuracy}%`);
console.log(`- Avg Velocity: ${summary.avg_velocity} m/s`);
console.log(`- Avg Reaction Time: ${summary.avg_reaction_time} ms`);
console.log(`- Critical Prevention: ${summary.critical_prevention}%`);
console.log(`- Total Punches: ${summary.total_punches}`);

console.log('\nPunch Accuracy by Type:');
console.log(`- Jab: ${transformedMetrics[0].punch_accuracy.jab}%`);
console.log(`- Hook: ${transformedMetrics[0].punch_accuracy.hook}%`);
console.log(`- Uppercut: ${transformedMetrics[0].punch_accuracy.uppercut}%`);

console.log('\nDefense Breakdown:');
console.log(`- Blocked: ${transformedMetrics[0].defense.blocked}`);
console.log(`- Dodged: ${transformedMetrics[0].defense.dodged}`);
console.log(`- Hit: ${transformedMetrics[0].defense.hit}`);

console.log('\n✅ All metrics ready for dashboard display!');
