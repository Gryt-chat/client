/* The channel scope matrix moved to @gryt/core. Both apps had a copy and had
   disagreed on the cell separator; the package keeps the NUL, as an escape. */
export {
  type CellState,
  cellState,
  type ChannelRule,
  CUSTOM_VALUE,
  describeRules,
  EVERYONE_VALUE,
  indexRules,
  nextCellState,
  type RuleEffect,
  type ScopeChoice,
  scopeChoiceFromValue,
  scopeChoiceValue,
  scopeOptions,
  scopeSetPayload,
  withCell,
} from "@gryt/core";
