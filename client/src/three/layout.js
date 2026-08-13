import * as THREE from 'three';

const _delta = new THREE.Vector3();

/**
 * One step of a 3D force-directed layout.
 *
 * Repulsion is O(n²), which is fine at the scale a polycule chart lives at
 * (hundreds of people at most) and keeps the result stable and predictable.
 *
 * @param bodies  Map<id, { position, velocity, locked, degree }>
 * @param edges   [{ source, target }]
 * @param params  { repulsion, springLength, springStrength, gravity }
 * @param alpha   0..1 cooling factor
 * @param dt      seconds since last step (clamped by the caller)
 */
export function stepLayout(bodies, edges, params, alpha, dt) {
  const { repulsion, springLength, springStrength, gravity } = params;
  const list = [...bodies.values()];
  const damping = 0.86;

  for (const body of list) body.force.set(0, 0, 0);

  // Pairwise repulsion.
  for (let i = 0; i < list.length; i += 1) {
    const a = list[i];
    for (let j = i + 1; j < list.length; j += 1) {
      const b = list[j];
      _delta.subVectors(a.position, b.position);
      let distanceSq = _delta.lengthSq();

      if (distanceSq < 0.0001) {
        // Coincident nodes: nudge them apart in a random direction.
        _delta.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
        distanceSq = _delta.lengthSq() || 0.0001;
      }

      const distance = Math.sqrt(distanceSq);
      const strength = repulsion / distanceSq;
      _delta.multiplyScalar(strength / distance);

      a.force.add(_delta);
      b.force.sub(_delta);
    }
  }

  // Spring attraction along edges.
  for (const edge of edges) {
    const a = bodies.get(edge.source);
    const b = bodies.get(edge.target);
    if (!a || !b) continue;

    _delta.subVectors(b.position, a.position);
    const distance = _delta.length() || 0.0001;
    const displacement = distance - springLength;
    _delta.multiplyScalar((displacement * springStrength) / distance);

    a.force.add(_delta);
    b.force.sub(_delta);
  }

  // Gentle pull toward the origin so disconnected clusters do not drift away.
  for (const body of list) {
    _delta.copy(body.position).multiplyScalar(-gravity);
    body.force.add(_delta);
  }

  const step = Math.min(dt, 1 / 30) * 60; // normalise to 60fps units
  for (const body of list) {
    if (body.locked) {
      body.velocity.set(0, 0, 0);
      continue;
    }
    body.velocity.add(body.force.multiplyScalar(alpha * step * 0.02));
    body.velocity.multiplyScalar(damping);

    // Clamp so a spike in force cannot fling a node into the void.
    const speed = body.velocity.length();
    const maxSpeed = 12;
    if (speed > maxSpeed) body.velocity.multiplyScalar(maxSpeed / speed);

    body.position.addScaledVector(body.velocity, step);
  }
}

/** Total kinetic energy — used to decide when the layout has settled. */
export function layoutEnergy(bodies) {
  let energy = 0;
  for (const body of bodies.values()) energy += body.velocity.lengthSq();
  return energy;
}
