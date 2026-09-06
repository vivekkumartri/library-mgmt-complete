const sheetsService = require('../services/googleSheetsService');
const { uuid } = require('../utils/id');

/**
 * Generic repository over a single sheet. This is the ONLY layer that
 * should import googleSheetsService directly outside of scripts/. Business
 * logic (controllers/services) should depend on repositories, not on
 * Sheets directly — so migrating to Postgres/Mongo later means rewriting
 * this file's implementation, not every controller.
 */
class BaseRepository {
  constructor(sheetName, idColumn) {
    this.sheetName = sheetName;
    this.idColumn = idColumn;
  }

  async findAll(filterFn) {
    const { rows } = await sheetsService.getAll(this.sheetName);
    return filterFn ? rows.filter(filterFn) : rows;
  }

  async findById(id) {
    const found = await sheetsService.findById(this.sheetName, this.idColumn, id);
    return found ? found.row : null;
  }

  async create(data) {
    const record = { [this.idColumn]: data[this.idColumn] || uuid(), ...data };
    if (!data[this.idColumn]) record[this.idColumn] = data[this.idColumn] || uuid();
    await sheetsService.append(this.sheetName, record);
    return record;
  }

  async update(id, patch) {
    return sheetsService.updateById(this.sheetName, this.idColumn, id, patch);
  }

  /** Permanent hard delete — see googleSheetsService.deleteById for caveats. */
  async delete(id) {
    return sheetsService.deleteById(this.sheetName, this.idColumn, id);
  }
}

module.exports = { BaseRepository };
