const parseExplicitBoolean = (value, defaultValue) => {
  if (value === undefined) {
    return {
      valid: true,
      value: defaultValue,
      provided: false,
    };
  }

  if (value === true || value === 1) {
    return { valid: true, value: true, provided: true };
  }

  if (value === false || value === 0) {
    return { valid: true, value: false, provided: true };
  }

  if (typeof value === "string") {
    const normalizedValue = value.trim().toLowerCase();

    if (normalizedValue === "true" || normalizedValue === "1") {
      return { valid: true, value: true, provided: true };
    }

    if (normalizedValue === "false" || normalizedValue === "0") {
      return { valid: true, value: false, provided: true };
    }
  }

  return {
    valid: false,
    value: defaultValue,
    provided: true,
  };
};

module.exports = {
  parseExplicitBoolean,
};
