"use strict";
/**
 * Applies one structured operation object to a repo by calling straight into
 * the builder engine - the same functions the REST API uses. This is what
 * makes the AI copilot "just another client" rather than a special path.
 */

const engine = require("./builderEngine");

function applyOperation(repoPath, op) {
  switch (op.op) {
    case "update_text":
      return engine.updateText(repoPath, op.id, op.value);
    case "update_image":
      return engine.updateImage(repoPath, op.id, { src: op.src, alt: op.alt });
    case "update_link":
      return engine.updateLink(repoPath, op.id, op.href);
    case "update_style":
      return engine.updateStyle(repoPath, op.id, op.style || {});
    case "move":
      return engine.moveElement(repoPath, op.id, op.dx || 0, op.dy || 0);
    case "resize":
      return engine.resizeElement(repoPath, op.id, op.widthPct || 100, op.heightPct || 100);
    case "set_visibility":
      return engine.setVisibility(repoPath, op.id, !!op.visible);
    case "create_element":
      return engine.createElement(repoPath, {
        type: op.type, id: op.id, parent: op.parent, text: op.text, src: op.src, alt: op.alt, href: op.href,
      });
    case "delete_element":
      return engine.deleteElement(repoPath, op.id);
    case "duplicate_element":
      return engine.duplicateElement(repoPath, op.id);
    case "reorder_element":
      return engine.reorderElement(repoPath, op.id, op.direction);
    default:
      throw new engine.BuilderError(`Unknown operation "${op.op}"`, "UNKNOWN_OP");
  }
}

module.exports = { applyOperation };
