import test from "ava";
import { AdaptiveSamplingController } from "./AdaptiveSamplingController";

test("pre-app-start requests bypass sampling and always record", (t) => {
  const controller = new AdaptiveSamplingController(
    {
      mode: "adaptive",
      baseRate: 0,
      minRate: 0,
    },
    {
      randomFn: () => 0.99,
      nowFn: () => 0,
    },
  );

  const decision = controller.getDecision({
    isPreAppStart: true,
  });

  t.true(decision.shouldRecord);
  t.is(decision.reason, "pre_app_start");
  t.is(decision.effectiveRate, 1);
});

test("adaptive controller sheds load and enters critical pause on drops", (t) => {
  let now = 0;
  const controller = new AdaptiveSamplingController(
    {
      mode: "adaptive",
      baseRate: 0.5,
      minRate: 0.1,
    },
    {
      randomFn: () => 0.3,
      nowFn: () => now,
    },
  );

  controller.update({
    queueFillRatio: 0.9,
  });

  const loadShedDecision = controller.getDecision({
    isPreAppStart: false,
  });
  t.is(loadShedDecision.state, "hot");
  t.true(loadShedDecision.effectiveRate < 0.5);
  t.false(loadShedDecision.shouldRecord);
  t.is(loadShedDecision.reason, "load_shed");

  now += 1;
  controller.update({
    queueFillRatio: 0.2,
    droppedSpanCount: 1,
  });

  const pausedDecision = controller.getDecision({
    isPreAppStart: false,
  });
  t.is(pausedDecision.state, "critical_pause");
  t.false(pausedDecision.shouldRecord);
  t.is(pausedDecision.reason, "critical_pause");
});

test("adaptive controller reports load_shed when load shedding underflows effective rate to zero", (t) => {
  const controller = new AdaptiveSamplingController(
    {
      mode: "adaptive",
      baseRate: Number.MIN_VALUE,
      minRate: 0,
    },
    {
      randomFn: () => 0.5,
      nowFn: () => 1,
    },
  );

  controller.update({
    queueFillRatio: 0.9,
  });

  const decision = controller.getDecision({
    isPreAppStart: false,
  });

  t.false(decision.shouldRecord);
  t.is(decision.effectiveRate, 0);
  t.is(decision.state, "hot");
  t.is(decision.reason, "load_shed");
});
