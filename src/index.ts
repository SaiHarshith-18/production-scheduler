import { ReflowService } from "./reflow/reflow.service.js";
import { scenarios } from "./scenarios/reflow-scenarios.js";

function printScenarioHeader(title: string, id: string): void {
  console.log(`\n=== ${title} (${id}) ===`);
}

function printSuccessResult(result: ReturnType<ReflowService["reflow"]>): void {
  console.log("Explanation:", result.explanation);
  console.log("Changes:");

  if (result.changes.length === 0) {
    console.log("  - None");
  } else {
    for (const change of result.changes) {
      console.log(
        `  - ${change.workOrderNumber}: ${change.previousStartDate} -> ${change.newStartDate} (${change.movedByMinutes} min), reason: ${change.reason}`,
      );
    }
  }

  console.log("Updated Work Orders:");
  for (const order of result.updatedWorkOrders) {
    console.log(
      `  - ${order.data.workOrderNumber} [${order.docId}] (${order.data.workCenterId}) start=${order.data.startDate} end=${order.data.endDate} maintenance=${order.data.isMaintenance}`,
    );
  }
}

function runScenarios(): void {
  const service = new ReflowService();

  for (const scenario of scenarios) {
    printScenarioHeader(scenario.title, scenario.id);
    console.log(scenario.description);

    try {
      const result = service.reflow(scenario.input);

      if (scenario.expectFailure) {
        console.log("Status: FAILED (expected an error but reflow succeeded)");
        printSuccessResult(result);
        continue;
      }

      console.log("Status: SUCCESS");
      printSuccessResult(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (scenario.expectFailure) {
        console.log(`Status: SUCCESS (expected failure observed) -> ${message}`);
      } else {
        console.log(`Status: FAILED -> ${message}`);
      }
    }
  }
}

runScenarios();
