import { installComputerExecutionActions } from './computer_store_execution.js';
import { installComputerControlActions } from './computer_store_control.js';

export function installComputerStoreActions(ComputerStore){
  installComputerControlActions(ComputerStore);
  installComputerExecutionActions(ComputerStore);
}
