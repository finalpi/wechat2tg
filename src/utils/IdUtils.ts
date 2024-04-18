export class UniqueIdGenerator {
    private static instance: UniqueIdGenerator;
    private idCounters: Map<string, number>;

    private constructor() {
        this.idCounters = new Map<string, number>();
    }

    static getInstance(): UniqueIdGenerator {
        if (!UniqueIdGenerator.instance) {
            UniqueIdGenerator.instance = new UniqueIdGenerator();
        }
        return UniqueIdGenerator.instance;
    }

    generateId(prefix: string): string {
        let counter = this.idCounters.get(prefix) || 0;
        counter++;
        this.idCounters.set(prefix, counter);
        return `${prefix}_${counter}`;
    }
}

