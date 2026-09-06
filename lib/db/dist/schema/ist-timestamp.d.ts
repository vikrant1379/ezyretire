export declare const istTimestamp: {
    (): import("drizzle-orm/pg-core").PgCustomColumnBuilder<{
        name: "";
        dataType: "custom";
        columnType: "PgCustomColumn";
        data: Date;
        driverParam: string;
        enumValues: undefined;
    }>;
    <TConfig extends Record<string, any>>(fieldConfig?: TConfig | undefined): import("drizzle-orm/pg-core").PgCustomColumnBuilder<{
        name: "";
        dataType: "custom";
        columnType: "PgCustomColumn";
        data: Date;
        driverParam: string;
        enumValues: undefined;
    }>;
    <TName extends string>(dbName: TName, fieldConfig?: unknown): import("drizzle-orm/pg-core").PgCustomColumnBuilder<{
        name: TName;
        dataType: "custom";
        columnType: "PgCustomColumn";
        data: Date;
        driverParam: string;
        enumValues: undefined;
    }>;
};
export declare const defaultIstNow: import("drizzle-orm").SQL<unknown>;
//# sourceMappingURL=ist-timestamp.d.ts.map