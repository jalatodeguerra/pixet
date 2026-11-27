import test from "node:test";
import assert from "node:assert/strict";
import {
  pickNearestVertex,
  pickNearestSegment,
  pointSegmentDistance,
  isDepthVisible,
  toggleInList,
} from "../src/engine/model3d/pickSubElements.ts";

const P = (x: number, y: number, depth = 1) => ({ x, y, depth });

test("pickNearestVertex picks nearest within radius", () => {
  const pts = [P(100, 100), P(108, 100), P(300, 300)];
  assert.equal(pickNearestVertex(pts, 107, 101, 12), 1);
  assert.equal(pickNearestVertex(pts, 100, 100, 12), 0);
});

test("pickNearestVertex returns -1 outside radius and skips null points", () => {
  const pts = [null, P(100, 100)];
  assert.equal(pickNearestVertex(pts, 130, 100, 12), -1);
  assert.equal(pickNearestVertex(pts, 105, 100, 12), 1);
});

test("pickNearestVertex falls through occluded candidates", () => {
  const pts = [P(100, 100), P(104, 100)];
  assert.equal(pickNearestVertex(pts, 99, 100, 12, (i) => i !== 0), 1);
  assert.equal(pickNearestVertex(pts, 99, 100, 12, () => false), -1);
});

test("pointSegmentDistance clamps to endpoints", () => {
  assert.equal(pointSegmentDistance(5, 3, 0, 0, 10, 0).dist, 3);
  const r = pointSegmentDistance(-4, 3, 0, 0, 10, 0);
  assert.equal(r.dist, 5);
  assert.equal(r.t, 0);
});

test("pickNearestSegment picks nearest segment within radius", () => {
  const pts = [P(0, 0), P(100, 0), P(100, 100)];
  const edges: Array<[number, number]> = [[0, 1], [1, 2]];
  assert.equal(pickNearestSegment(pts, edges, 50, 6, 10), 0);
  assert.equal(pickNearestSegment(pts, edges, 96, 50, 10), 1);
  assert.equal(pickNearestSegment(pts, edges, 50, 40, 10), -1);
});

test("isDepthVisible uses a distance-scaled epsilon", () => {
  assert.equal(isDepthVisible(10, null), true);
  assert.equal(isDepthVisible(10, 10), true);
  assert.equal(isDepthVisible(10.02, 10), true);
  assert.equal(isDepthVisible(12, 10), false);
});

test("toggleInList adds then removes", () => {
  assert.deepEqual(toggleInList([1, 2], 3), [1, 2, 3]);
  assert.deepEqual(toggleInList([1, 2, 3], 2), [1, 3]);
  assert.deepEqual(
    toggleInList<[number, number]>([[1, 2]], [1, 2], (a, b) => a[0] === b[0] && a[1] === b[1]),
    []
  );
});
